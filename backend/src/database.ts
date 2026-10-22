import {AsyncLocalStorage} from 'node:async_hooks';
import type {SQLInputValue} from 'node:sqlite';
import type {Store} from './store.js';

export interface Database {
  readonly dialect:'sqlite'|'mysql';
  run(sql:string,...args:SQLInputValue[]):Promise<unknown>;
  get<T>(sql:string,...args:SQLInputValue[]):Promise<T|undefined>;
  all<T>(sql:string,...args:SQLInputValue[]):Promise<T[]>;
  transaction<T>(work:()=>Promise<T>):Promise<T>;
  afterCommit(work:()=>void):void;
  close():Promise<void>;
}
interface Transaction {active:boolean;callbacks:(()=>void)[]}

/** Serialize SQLite operations, including async transactions, in local development. */
export class SQLiteDatabase implements Database {
  readonly dialect='sqlite' as const;
  private tail:Promise<unknown>=Promise.resolve();
  private context=new AsyncLocalStorage<Transaction>();
  constructor(private store:Store) {}
  private serial<T>(work:()=>T|Promise<T>):Promise<T> {
    if(this.context.getStore()?.active)return Promise.resolve().then(work);
    const next=this.tail.then(work,work);this.tail=next.catch(()=>{});return next;
  }
  async run(sql:string,...args:SQLInputValue[]) {return this.serial(()=>this.store.run(sql,...args))}
  async get<T>(sql:string,...args:SQLInputValue[]) {return this.serial(()=>this.store.get<T>(sql,...args))}
  async all<T>(sql:string,...args:SQLInputValue[]) {return this.serial(()=>this.store.all<T>(sql,...args))}
  transaction<T>(work:()=>Promise<T>):Promise<T> {
    if(this.context.getStore()?.active)return work();
    return this.serial(async()=> {
      const state:Transaction={active:true,callbacks:[]};let committed=false;this.store.db.exec('BEGIN IMMEDIATE');
      try {
        const value=await this.context.run(state,work);this.store.db.exec('COMMIT');committed=true;state.active=false;
        for(const callback of state.callbacks)callback();return value;
      }catch(error){if(!committed)this.store.db.exec('ROLLBACK');throw error}finally{state.active=false}
    });
  }
  afterCommit(work:()=>void) {const state=this.context.getStore();if(state?.active)state.callbacks.push(work);else work()}
  async close(){await this.tail;this.store.db.close()}
}
