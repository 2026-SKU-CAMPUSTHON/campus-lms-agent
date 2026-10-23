import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {generationConfig} from './ai/config.js';
import { createApp } from './app.js';
import {MySQLDatabase} from './mysql.js';
import {bootstrapProfessor} from './auth/routes.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
config({path:resolve(root,'.env'),quiet:true});
const production=process.env.NODE_ENV==='production';
const demoAuth=process.env.ENABLE_DEMO_AUTH==='true';
const database=process.env.MYSQL_URL?new MySQLDatabase(process.env.MYSQL_URL,{tls:process.env.MYSQL_TLS==='true',sslCA:process.env.MYSQL_SSL_CA}):undefined;
if(demoAuth&&database)throw new Error('체험 로그인과 MYSQL_URL을 함께 사용할 수 없습니다.');
if(!demoAuth&&!database)throw new Error('실제 로그인에는 MYSQL_URL 설정이 필요합니다.');
if(production&&(demoAuth||!database||!process.env.APP_ORIGIN))throw new Error('배포에는 MySQL, HTTPS APP_ORIGIN, ENABLE_DEMO_AUTH=false 설정이 필요합니다.');
if(production&&process.env.AI_PROVIDER==='codex')throw new Error('배포에서는 CLI 대신 Claude API를 설정하세요.');
if(database){await database.migrate(root);await database.acquireRuntimeLock()}
if(process.env.BOOTSTRAP_EMAIL||process.env.BOOTSTRAP_PASSWORD){
  if(!database||!process.env.BOOTSTRAP_EMAIL||!process.env.BOOTSTRAP_PASSWORD)throw new Error('BOOTSTRAP_EMAIL과 BOOTSTRAP_PASSWORD를 함께 설정하세요.');
  const result=await bootstrapProfessor(database,{email:process.env.BOOTSTRAP_EMAIL,password:process.env.BOOTSTRAP_PASSWORD,name:process.env.BOOTSTRAP_NAME||'담당 교수',courseTitle:process.env.BOOTSTRAP_COURSE||'팀 테스트 강의'});
  console.log(result.created?'최초 교수 계정과 강의를 만들었습니다.':'기존 최초 계정을 유지합니다.');
}
const port=Number(process.env.PORT || 3000);
const service=createApp({...generationConfig(),jevApiKey:process.env.TYPESAFE_API_KEY,jevModel:process.env.JEV_MODEL,jevMinimum:Number(process.env.JEV_MIN_CONFIDENCE || 0.75),root,dataDir:resolve(root,process.env.DATA_DIR || '.data'),demoAuth,database,production,publicOrigin:process.env.APP_ORIGIN,frontendDir:resolve(root,'frontend/dist')});
await service.initialized;
const host=process.env.HOST||(production?'0.0.0.0':'127.0.0.1');
const server=service.app.listen(port,host,()=>console.log(`Campus LMS: ${production?process.env.APP_ORIGIN:`http://${host}:${port}`}`));
for(const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>{server.close(()=>{void service.close().then(()=>process.exit(0))})});
