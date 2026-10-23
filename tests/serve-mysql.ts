/** Disposable MySQL browser-test server. Never used by the deployment entrypoint. */
import {MySQLDatabase} from '../backend/src/mysql.js';
import {bootstrapProfessor} from '../backend/src/auth/routes.js';
import {createApp} from '../backend/src/app.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const url=process.env.MYSQL_TEST_URL;
if(!url||new URL(url).pathname!=='/campus_test')throw new Error('Browser tests require a disposable MYSQL_TEST_URL ending in /campus_test.');
const root=fileURLToPath(new URL('../',import.meta.url)),database=new MySQLDatabase(url);
await database.migrate(root);
for(const table of ['course_invites','auth_credentials','idempotency','threads','jobs','attempts','quizzes','drafts','materials','sessions','memberships','weeks','courses','users'])await database.run(`DELETE FROM ${table}`);
await bootstrapProfessor(database,{email:'teacher@example.test',password:'Browser-test-password-2026',name:'교수 테스트',courseTitle:'팀 공동 테스트'});
const dataDir=mkdtempSync(resolve(tmpdir(),'campus-mysql-browser-'));
const service=createApp({root,dataDir,demoAuth:false,database,generator:async(slides,count,previous=[])=>Array.from({length:count},(_,i)=>({prompt:`정규화는 무엇을 줄이나요? ${previous.length+i+1}`,options:['중복','정확도','학생 수','주차 수'],correct_index:0,explanation:'정규화는 데이터 중복을 줄입니다.',slide_nos:[slides[0].slide_no]}))});
await service.initialized;const server=service.app.listen(3101,'127.0.0.1');
process.once('SIGTERM',()=>server.close(()=>void service.close().then(()=>{rmSync(dataDir,{recursive:true,force:true});process.exit(0)})));
