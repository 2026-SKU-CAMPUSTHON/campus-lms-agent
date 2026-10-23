import {AsyncLocalStorage} from 'node:async_hooks';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import mysql,{type Pool,type PoolConnection,type RowDataPacket} from 'mysql2/promise';
import type {SQLInputValue} from 'node:sqlite';
import type {Database} from './database.js';
interface Transaction {connection:PoolConnection;active:boolean;callbacks:(()=>void)[]}

/** Only the legacy JSON scalar/upsert syntax differs; SQL values stay bound parameters. */
export function mysqlSQL(sql:string):string {
  return sql.replace(/json_extract\(([^,]+),'(\$\.[a-z_]+)'\)/gi,"JSON_UNQUOTE(JSON_EXTRACT($1,'$2'))")
    .replace(/INSERT OR REPLACE INTO jobs VALUES \(\?,\?,\?\)/gi,'INSERT INTO jobs (id,course_id,data) VALUES (?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)');
}
export class MySQLDatabase implements Database {
  readonly dialect='mysql' as const;
  readonly pool:Pool;
  private context=new AsyncLocalStorage<Transaction>();
  private runtimeConnection?:PoolConnection;
  private runtimeTimer?:NodeJS.Timeout;
  private lockName:string;
  constructor(url:string,options:{sslCA?:string;tls?:boolean}={}) {
    const parsed=new URL(url);
    if(parsed.protocol!=='mysql:'||!parsed.pathname.slice(1))throw new Error('MYSQL_URL must identify a MySQL database.');
    this.pool=mysql.createPool({host:parsed.hostname,port:Number(parsed.port||3306),user:decodeURIComponent(parsed.username),password:decodeURIComponent(parsed.password),database:decodeURIComponent(parsed.pathname.slice(1)),charset:'utf8mb4',connectionLimit:8,connectTimeout:10000,enableKeepAlive:true,multipleStatements:false,dateStrings:true,decimalNumbers:true,...(options.tls?{ssl:{rejectUnauthorized:true,...(options.sslCA?{ca:readFileSync(options.sslCA,'utf8')}:{})}}:{})});
    this.lockName='campus:'+createHash('sha256').update(parsed.pathname).digest('hex').slice(0,32);
  }
  private connection(){const state=this.context.getStore();return state?.active?state.connection:this.pool}
  async run(sql:string,...args:SQLInputValue[]){const [result]=await this.connection().query(mysqlSQL(sql),args);return result}
  async all<T>(sql:string,...args:SQLInputValue[]):Promise<T[]> {
    const [rows]=await this.connection().query<RowDataPacket[]>(mysqlSQL(sql),args);
    return rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,key==='clarification_count'?Number(value):value]))) as T[];
  }
  async get<T>(sql:string,...args:SQLInputValue[]){return (await this.all<T>(sql,...args))[0]}
  async transaction<T>(work:()=>Promise<T>):Promise<T> {
    if(this.context.getStore()?.active)return work();
    const connection=await this.pool.getConnection(),state:Transaction={connection,active:true,callbacks:[]};
    let locked=false,begun=false;
    try {
      const [rows]=await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?,15) AS locked',[this.lockName+':write']);
      if(rows[0].locked!==1)throw new Error('Database transaction lock timeout');locked=true;
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await connection.beginTransaction();begun=true;
      const result=await this.context.run(state,work);await connection.commit();begun=false;state.active=false;
      for(const callback of state.callbacks)callback();return result;
    }catch(error){if(begun)await connection.rollback();throw error}
    finally{state.active=false;if(locked)await connection.query('SELECT RELEASE_LOCK(?)',[this.lockName+':write']);connection.release()}
  }
  afterCommit(work:()=>void){const state=this.context.getStore();if(state?.active)state.callbacks.push(work);else work()}
  async migrate(root:string) {
    const connection=await this.pool.getConnection();let locked=false;
    try {
      const [rows]=await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?,30) AS locked',[this.lockName+':schema']);
      if(rows[0].locked!==1)throw new Error('Migration lock timeout');locked=true;
      await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(120) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
      for(const name of readdirSync(resolve(root,'mysql/migrations')).filter(n=>/^\d+_[a-z_]+\.sql$/.test(n)).sort()) {
        const source=readFileSync(resolve(root,'mysql/migrations',name),'utf8'),checksum=createHash('sha256').update(source).digest('hex');
        const [previous]=await connection.query<RowDataPacket[]>('SELECT checksum FROM schema_migrations WHERE name=?',[name]);
        if(previous.length){if(previous[0].checksum!==checksum)throw new Error('Applied migration changed: '+name);continue}
        for(const statement of source.split(';').map(s=>s.trim()).filter(Boolean))await connection.query(statement);
        await connection.query('INSERT INTO schema_migrations (name,checksum) VALUES (?,?)',[name,checksum]);
      }
    }finally{if(locked)await connection.query('SELECT RELEASE_LOCK(?)',[this.lockName+':schema']);connection.release()}
  }
  /** The current queues/files require one application process per database. */
  async acquireRuntimeLock() {
    const connection=await this.pool.getConnection();
    const [rows]=await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?,0) AS locked',[this.lockName+':runtime']);
    if(rows[0].locked!==1){connection.release();throw new Error('Another Campus LMS process owns this database. Use one replica.')}this.runtimeConnection=connection;
    // Losing this connection removes fencing. Stop rather than run concurrent queues.
    const lost=()=>{if(this.runtimeConnection===connection){console.error('Database runtime lock connection lost');process.exit(1)}};
    connection.on('error',lost);
    this.runtimeTimer=setInterval(()=>{void connection.ping().catch(lost)},30000);this.runtimeTimer.unref();
  }
  async close(){clearInterval(this.runtimeTimer);const connection=this.runtimeConnection;this.runtimeConnection=undefined;if(connection){await connection.query('SELECT RELEASE_LOCK(?)',[this.lockName+':runtime']);connection.release()}await this.pool.end()}
}
