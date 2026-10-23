import {afterEach,describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import {mkdtempSync,rmSync,readdirSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {HttpError} from '../src/errors.js';
import {IDS} from '../src/store.js';
import type {MediaMaterial,WeekContent} from '../src/types.js';
import type {Transcriber} from '../src/media/transcribe.js';
import {retrieve} from '../src/retrieval/local-search.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const resources:{app:ReturnType<typeof createApp>;dir:string}[]=[];
afterEach(async()=>{for(const r of resources.splice(0)){await r.app.close();rmSync(r.dir,{recursive:true,force:true})}});
const result={duration_sec:25,language:'ko',segments:[{start_sec:2,end_sec:12,text:'정규화는 데이터 중복을 줄이고 갱신 이상을 방지합니다.'},{start_sec:13,end_sec:23,text:'학생 정보와 수강 정보를 분리해 저장합니다.'}]};
const decision={model:'jev-test',clarity:{label:'clear' as const,confidence:1,probabilities:{clear:1,unclear:0}},evidence:{label:'sufficient' as const,confidence:1,probabilities:{sufficient:1,insufficient:0}}};
function setup(transcriber:Transcriber=async()=>result,dir=mkdtempSync(resolve(tmpdir(),'campus-media-'))) {
 const app=createApp({root,dataDir:dir,demoAuth:true,transcriber,qaJudge:async()=>decision,qaGenerator:async input=>({text:'정규화는 데이터 중복과 갱신 이상을 줄입니다.',source_ids:[input.passages[0].source.chunk_id]})});resources.push({app,dir});return app;
}
type App=ReturnType<typeof setup>;
async function login(app:App,user=IDS.professor){const agent=request.agent(app.app);await agent.post('/api/dev/login').send({user_id:user}).expect(200);return agent}
const base=`/api/courses/${IDS.course}/weeks/${IDS.week}`;
const audio=Buffer.from('test-only-media-transcriber-is-injected');
async function upload(prof:Awaited<ReturnType<typeof login>>,visible=false){return prof.post(base+'/media').field('source_type','audio').field('original_visible_to_students',String(visible)).attach('file',audio,'lecture.wav').expect(202)}
async function completed(app:App,prof:Awaited<ReturnType<typeof login>>,visible=false){const posted=await upload(prof,visible);await app.waitForJobs();return posted.body as {material_id:string;job_id:string}}
function material(app:App,id:string):MediaMaterial{return JSON.parse(app.store.get<{data:string}>('SELECT data FROM materials WHERE id=?',id)!.data)}
describe('미디어 전사·검색·권한 (전사/판단/생성은 명시적인 테스트 대역)',()=> {
 it('자동 전사한 시간 근거로 Q&A에 답하고 비공개 원본·전체 전사는 학생에게 감춘다',async()=> {
  const transcribe=vi.fn(async()=>result),app=setup(transcribe),prof=await login(app),student=await login(app,IDS.student);
  const receipt=await completed(app,prof);expect((await prof.get('/api/jobs/'+receipt.job_id)).body.status).toBe('completed');expect(transcribe).toHaveBeenCalledTimes(1);
  const m=material(app,receipt.material_id);expect(m.status).toBe('completed');expect(statSync(m.file_path).mode&0o777).toBe(0o600);
  const content=(await prof.get(base+'/content')).body as WeekContent;expect(JSON.stringify(content)).not.toMatch(/file_path|segments|데이터 중복/);
  expect((await student.get(base+'/content')).body.materials).toHaveLength(0);
  for(const endpoint of ['original','transcript','playback'])await student.get(`/api/materials/${m.material_id}/${endpoint}`).expect(403);
  const asked=await student.post(base+'/threads').set('Idempotency-Key',randomUUID()).send({text:'정규화는 왜 하나요?'}).expect(201);await app.waitForJobs();
  const answer=(await student.get('/api/threads/'+asked.body.thread_id)).body;expect(answer.state).toBe('resolved');expect(answer.messages.at(-1).sources[0]).toMatchObject({source_type:'transcript',slide_no:null,start_sec:2,end_sec:23,media_type:'audio',original_visible_to_students:false});
  const report=(await prof.get(`/api/courses/${IDS.course}/reports/qa`)).body;expect(report.threads[0].messages.at(-1).sources[0].start_sec).toBe(2);
  expect((await prof.get(`/api/materials/${m.material_id}/transcript`).expect(200)).body.segments).toHaveLength(2);
  await prof.get(`/api/materials/${m.material_id}/playback`).set('Range','bytes=0-9').expect(206);
 });
 it('공개 미디어의 전사·재생은 같은 강의 학생만 조회할 수 있다',async()=> {
  const app=setup(),prof=await login(app),student=await login(app,IDS.student),outsider=await login(app,IDS.outsider);const {material_id}=await completed(app,prof,true);
  await student.get(`/api/materials/${material_id}/transcript`).expect(200);await student.get(`/api/materials/${material_id}/playback`).set('Range','bytes=0-9').expect(206);
  await outsider.get(`/api/materials/${material_id}/transcript`).expect(403);await outsider.get(`/api/materials/${material_id}/playback`).expect(403);
  await request(app.app).get(`/api/materials/${material_id}/playback`).expect(401);
 });
 it('미디어를 문서 퀴즈에 섞거나 다른 강의·주차의 근거로 사용하지 않는다',async()=> {
  const app=setup(),prof=await login(app);const {material_id}=await completed(app,prof);const m=material(app,material_id);
  await prof.post(base+'/quiz-drafts').set('Idempotency-Key',randomUUID()).send({material_ids:[material_id],question_count:1}).expect(422);
  expect(retrieve([m],IDS.course,IDS.week2,'정규화')).toHaveLength(0);expect(retrieve([m],IDS.otherCourse,IDS.week,'정규화')).toHaveLength(0);expect(retrieve([{...m,status:'failed'}],IDS.course,IDS.week,'정규화')).toHaveLength(0);
 });
 it('전사 실패를 보존하고 원본을 지우지 않으며 명시적인 재시도로 복구한다',async()=> {
  const transcribe=vi.fn<Transcriber>().mockRejectedValueOnce(new HttpError(503,'MEDIA_NOT_CONFIGURED','전사 환경을 확인해 주세요.',true)).mockResolvedValue(result),app=setup(transcribe),prof=await login(app);
  const receipt=await completed(app,prof),m=material(app,receipt.material_id);expect(m.status).toBe('failed');expect(m.error?.code).toBe('MEDIA_NOT_CONFIGURED');expect(m.segments).toHaveLength(0);expect(existsSync(m.file_path)).toBe(true);
  const retry=await prof.post(`/api/materials/${m.material_id}/transcription-retry`).send({}).expect(202);expect(retry.body.job_id).not.toBe(receipt.job_id);await app.waitForJobs();expect(material(app,m.material_id).status).toBe('completed');
  expect((await prof.get('/api/jobs/'+receipt.job_id)).body.status).toBe('failed');await prof.post(`/api/materials/${m.material_id}/transcription-retry`).send({}).expect(409);
 });
 it('잘못된 시간 결과는 완료·검색 가능 상태로 저장하지 않는다',async()=> {
  const app=setup(async()=>({...result,segments:[{start_sec:5,end_sec:50,text:'잘못된 시간 정보'}]})),prof=await login(app);const {material_id}=await completed(app,prof);
  const m=material(app,material_id);expect(m.status).toBe('failed');expect(m.error?.code).toBe('INVALID_TRANSCRIPT');expect(retrieve([m],IDS.course,IDS.week,'시간')).toHaveLength(0);
 });
 it('업로드 권한·종류·필드를 검사하고 거부한 파일을 정리한다',async()=> {
  const app=setup(),prof=await login(app),student=await login(app,IDS.student),outsider=await login(app,IDS.outsider),dir=resources.find(r=>r.app===app)!.dir;
  for(const agent of [student,outsider])await agent.post(base+'/media').field('source_type','audio').field('original_visible_to_students','false').attach('file',audio,'lecture.wav').expect(403);
  await prof.post(base+'/media').field('source_type','video').field('original_visible_to_students','false').attach('file',audio,'lecture.wav').expect(422);
  await prof.post(base+'/media').field('source_type','audio').field('original_visible_to_students','false').attach('file',audio,'bad.txt').expect(422);
  expect(readdirSync(resolve(dir,'media'))).toHaveLength(0);
 });
 it('동시에 한 파일씩 전사하고 대기열 3개를 넘는 업로드는 접수하지 않는다',async()=> {
  let release!:()=>void;const first=new Promise<void>(resolve=>{release=resolve});let count=0;
  const transcribe=vi.fn<Transcriber>(async()=>{if(++count===1)await first;return result}),app=setup(transcribe),prof=await login(app);
  try {await upload(prof);await upload(prof);await upload(prof);await prof.post(base+'/media').field('source_type','audio').field('original_visible_to_students','false').attach('file',audio,'extra.wav').expect(429);expect(transcribe).toHaveBeenCalledTimes(1)}finally{release();await app.waitForJobs()}
  expect(transcribe).toHaveBeenCalledTimes(3);
 });
 it('서버 재시작 후 전사·시간 출처를 보존하고 중단 작업에는 재시도를 제공한다',async()=> {
  const app=setup(),prof=await login(app);const {material_id,job_id}=await completed(app,prof);const saved=material(app,material_id);const item=resources.find(r=>r.app===app)!;
  saved.status='processing';saved.error=null;saved.segments=[];app.store.run('UPDATE materials SET data=? WHERE id=?',JSON.stringify(saved),material_id);app.store.run('UPDATE jobs SET data=? WHERE id=?',JSON.stringify({job_id,status:'processing',result:null,error:null}),job_id);
  await app.close();resources.splice(resources.indexOf(item),1);
  const restarted=setup(async()=>result,item.dir),returning=await login(restarted);expect(material(restarted,material_id).error?.code).toBe('PROCESS_INTERRUPTED');
  await returning.post(`/api/materials/${material_id}/transcription-retry`).send({}).expect(202);await restarted.waitForJobs();expect(material(restarted,material_id).segments[0].start_sec).toBe(2);
 });
});
