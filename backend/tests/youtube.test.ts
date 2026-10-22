import {afterEach,describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {IDS} from '../src/store.js';
import {HttpError} from '../src/errors.js';
import {parseYouTubeUrl} from '../src/media/youtube-url.js';
import type {YouTubeImporter} from '../src/media/youtube.js';
import type {MediaMaterial} from '../src/types.js';
import {retrieve} from '../src/retrieval/local-search.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),base=`/api/courses/${IDS.course}/weeks/${IDS.week}`;
const resources:{app:ReturnType<typeof createApp>;dir:string}[]=[];
afterEach(async()=>{for(const r of resources.splice(0)){await r.app.close();rmSync(r.dir,{recursive:true,force:true})}});
const data={name:'합성 YouTube 강의',method:'captions' as const,is_generated:true,transcription:{duration_sec:2819,language:'ko',segments:[{start_sec:732,end_sec:780,text:'공학수학의 중장기 목표는 배운 내용을 전공 과목에서 활용하는 것입니다.'}]}};
function setup(importer:YouTubeImporter=async()=>data,dir=mkdtempSync(resolve(tmpdir(),'campus-youtube-'))) {
 const app=createApp({root,dataDir:dir,demoAuth:true,youtubeImporter:importer,qaJudge:async()=>({model:'test',clarity:{label:'clear',confidence:1,probabilities:{clear:1,unclear:0}},evidence:{label:'sufficient',confidence:1,probabilities:{sufficient:1,insufficient:0}}}),qaGenerator:async input=>({text:'배운 내용을 전공 과목에 활용하는 것입니다.',source_ids:[input.passages[0].source.chunk_id]})});resources.push({app,dir});return app;
}
async function login(app:ReturnType<typeof setup>,user=IDS.professor){const agent=request.agent(app.app);await agent.post('/api/dev/login').send({user_id:user}).expect(200);return agent}
const body={url:'https://www.youtube.com/watch?v=XwsPTAnFRsk&t=732s',original_visible_to_students:false};
function material(app:ReturnType<typeof setup>,id:string):MediaMaterial{return JSON.parse(app.store.get<{data:string}>('SELECT data FROM materials WHERE id=?',id)!.data)}
describe('YouTube 입력·권한·작업과 Q&A (네트워크·모델 대역)',()=> {
 it('watch/짧은 링크/shorts를 정규화하고 링크의 시작 시간을 보존한다',()=> {
  for(const url of [body.url,'https://youtu.be/XwsPTAnFRsk?t=12m12s','https://m.youtube.com/watch?v=XwsPTAnFRsk#t=732','https://www.youtube.com/embed/XwsPTAnFRsk?start=732'])expect(parseYouTubeUrl(url)).toEqual({video_id:'XwsPTAnFRsk',url:'https://www.youtube.com/watch?v=XwsPTAnFRsk',start_sec:732});
  expect(parseYouTubeUrl('https://youtube.com/shorts/XwsPTAnFRsk?list=PL123').start_sec).toBe(0);
 });
 it('임의 URL·호스트 위장·자격 정보·잘못된 ID/시간·재생목록을 네트워크 전에 거부한다',()=> {
  for(const url of ['http://localhost/watch?v=XwsPTAnFRsk','https://youtube.com.evil.test/watch?v=XwsPTAnFRsk','https://youtube.com@127.0.0.1/watch?v=XwsPTAnFRsk','https://a:b@youtube.com/watch?v=XwsPTAnFRsk','https://youtube.com:444/watch?v=XwsPTAnFRsk','https://youtu.be/../x','https://youtube.com/playlist?list=abc','https://youtube.com/watch?v=short',body.url+'&t=1',body.url+'&start=1','https://youtu.be/XwsPTAnFRsk?t=-1','https://youtu.be/XwsPTAnFRsk?t=2h'])expect(()=>parseYouTubeUrl(url)).toThrow();
 });
 it('교수만 접수하고 선택 범위 밖 근거·다른 주차/강의를 제외한다',async()=> {
  const imported=vi.fn<YouTubeImporter>(async()=>data),app=setup(imported),prof=await login(app),student=await login(app,IDS.student),outsider=await login(app,IDS.outsider);
  for(const agent of [student,outsider])await agent.post(base+'/youtube').send(body).expect(403);
  await prof.post(base+'/youtube').send({...body,url:'https://127.0.0.1/private'}).expect(422);await prof.post(base+'/youtube').send({...body,end_sec:500}).expect(422);expect(imported).not.toHaveBeenCalled();
  const receipt=(await prof.post(base+'/youtube').send({...body,end_sec:852}).expect(202)).body;await app.waitForJobs();
  expect(imported.mock.calls[0][0]).toMatchObject({video_id:'XwsPTAnFRsk',start_sec:732,end_sec:852});
  const m=material(app,receipt.material_id);expect(m.youtube?.method).toBe('captions');expect(m.name).toBe(data.name);
  expect(retrieve([m],IDS.course,IDS.week2,'전공 활용')).toHaveLength(0);expect(retrieve([m],IDS.otherCourse,IDS.week,'전공 활용')).toHaveLength(0);
  await prof.post(base+'/quiz-drafts').set('Idempotency-Key',randomUUID()).send({material_ids:[m.material_id],question_count:1}).expect(422);
 });
 it('비공개 전사/원본 링크를 보호하면서 Q&A·레포트의 절대 시간 출처를 보존한다',async()=> {
  const app=setup(),prof=await login(app),student=await login(app,IDS.student);const receipt=(await prof.post(base+'/youtube').send(body)).body;await app.waitForJobs();
  for(const endpoint of ['original','transcript','playback'])await student.get(`/api/materials/${receipt.material_id}/${endpoint}`).expect(403);
  expect((await student.get(base+'/content')).body.materials).toHaveLength(0);
  const asked=(await student.post(base+'/threads').set('Idempotency-Key',randomUUID()).send({text:'공학수학 학습의 중장기 목표는 무엇인가요?'}).expect(201)).body;await app.waitForJobs();
  const thread=(await student.get('/api/threads/'+asked.thread_id)).body;expect(thread.state).toBe('resolved');const source=thread.messages.at(-1).sources[0];expect(source).toMatchObject({origin:'youtube',start_sec:732,end_sec:780,slide_no:null,original_visible_to_students:false});expect(JSON.stringify(thread)).not.toContain('XwsPTAnFRsk');
  const report=(await prof.get(`/api/courses/${IDS.course}/reports/qa`)).body;expect(report.threads[0].messages.at(-1).sources[0].origin).toBe('youtube');
  const watch=await prof.get(`/api/materials/${receipt.material_id}/playback?start=746`).expect(302);expect(watch.headers.location).toBe('https://www.youtube.com/watch?v=XwsPTAnFRsk&t=746s');
 });
 it('공개 원본은 권한 검사 후 정규 YouTube 시각으로만 이동하고 임의 리다이렉트를 거부한다',async()=> {
  const app=setup(),prof=await login(app),student=await login(app,IDS.student),outsider=await login(app,IDS.outsider);const {material_id}= (await prof.post(base+'/youtube').send({...body,original_visible_to_students:true})).body;await app.waitForJobs();
  await student.get(`/api/materials/${material_id}/transcript`).expect(200);expect((await student.get(`/api/materials/${material_id}/original`).expect(302)).headers.location).toContain('&t=732s');
  await student.get(`/api/materials/${material_id}/playback?start=0`).expect(422);await student.get(`/api/materials/${material_id}/playback?start=https://evil.test`).expect(422);await outsider.get(`/api/materials/${material_id}/playback`).expect(403);
 });
 it('가져오기 제한을 오류로 보존하고 로컬 파일 없이 새 Job으로 재시도한다',async()=> {
  const importer=vi.fn<YouTubeImporter>().mockRejectedValueOnce(new HttpError(422,'YOUTUBE_ACCESS_BLOCKED','YouTube 접근이 제한되었습니다.',true)).mockResolvedValue({...data,method:'audio',is_generated:null});const app=setup(importer),prof=await login(app);const receipt=(await prof.post(base+'/youtube').send(body)).body;await app.waitForJobs();
  expect(material(app,receipt.material_id).error?.code).toBe('YOUTUBE_ACCESS_BLOCKED');const retry=(await prof.post(`/api/materials/${receipt.material_id}/transcription-retry`).send({}).expect(202)).body;await app.waitForJobs();expect(retry.job_id).not.toBe(receipt.job_id);expect(material(app,receipt.material_id).youtube?.method).toBe('audio');
 });
 it('구간 밖 전사는 검색에 넣지 않고 재시작 후 YouTube 메타데이터를 유지한다',async()=> {
  const app=setup(async()=>({...data,transcription:{...data.transcription,segments:[{start_sec:1,end_sec:10,text:'선택 이전의 근거'}]}})),prof=await login(app);const receipt=(await prof.post(base+'/youtube').send(body)).body;await app.waitForJobs();expect(material(app,receipt.material_id).error?.code).toBe('INVALID_TRANSCRIPT');
  const item=resources.find(r=>r.app===app)!;await app.close();resources.splice(resources.indexOf(item),1);const restarted=setup(async()=>data,item.dir);expect(material(restarted,receipt.material_id).youtube?.start_sec).toBe(732);
  const returning=await login(restarted);await returning.post(`/api/materials/${receipt.material_id}/transcription-retry`).send({}).expect(202);await restarted.waitForJobs();expect(material(restarted,receipt.material_id).status).toBe('completed');
 });
});
