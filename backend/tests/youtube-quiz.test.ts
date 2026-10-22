import {afterEach,describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createApp,type AppOptions} from '../src/app.js';
import {IDS} from '../src/store.js';
import {HttpError} from '../src/errors.js';
import {createClaudeTranscriptGenerator,generateYouTubeQuestions,validateTranscriptQuestions,type TranscriptGenerator} from '../src/quiz-generation/transcript.js';
import {materialPassages} from '../src/retrieval/local-search.js';
import type {MediaMaterial} from '../src/types.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),base=`/api/courses/${IDS.course}/weeks/${IDS.week}`;
const resources:{app:ReturnType<typeof createApp>;dir:string}[]=[];
afterEach(async()=>{for(const r of resources.splice(0)){await r.app.close();rmSync(r.dir,{recursive:true,force:true})}});
function material():MediaMaterial {return {material_id:randomUUID(),course_id:IDS.course,week_id:IDS.week,name:'합성 푸리에 강의',source_type:'video',original_visible_to_students:false,status:'completed',file_path:'',slide_start:null,slide_end:null,total_slides:null,slides:[],duration_sec:1000,language:'ko',segments:[{start_sec:732,end_sec:780,text:'푸리에 급수는 주기 함수를 사인과 코사인의 합으로 표현합니다.'},{start_sec:790,end_sec:840,text:'내적이 0인 두 함수는 직교합니다.'}],job_id:randomUUID(),error:null,youtube:{video_id:'XwsPTAnFRsk',url:'https://www.youtube.com/watch?v=XwsPTAnFRsk',start_sec:732,end_sec:852,method:'captions',is_generated:true}}}
const fake:TranscriptGenerator=async(passages,count,previous=[])=>Array.from({length:count},(_,i)=>({prompt:`주기 함수를 표현하는 방법은 무엇인가요? (${previous.length+i+1})`,options:['사인과 코사인의 합','데이터 삭제','무작위 복제','항상 0'],correct_index:0,explanation:'강의에서는 푸리에 급수로 주기 함수를 사인과 코사인의 합으로 표현합니다.',source_ids:[passages[i%passages.length].source.chunk_id]}));
function setup(generator:TranscriptGenerator|undefined=fake,overrides:Partial<AppOptions>={},dir=mkdtempSync(resolve(tmpdir(),'campus-youtube-quiz-'))) {const app=createApp({root,dataDir:dir,demoAuth:true,transcriptGenerator:generator,...overrides});resources.push({app,dir});return app}
async function login(app:ReturnType<typeof setup>,user=IDS.professor) {const agent=request.agent(app.app);await agent.post('/api/dev/login').send({user_id:user}).expect(200);return agent}
function save(app:ReturnType<typeof setup>,m:MediaMaterial) {app.store.run('INSERT INTO materials VALUES (?,?,?,?)',m.material_id,m.course_id,m.week_id,JSON.stringify(m))}
async function generate(app:ReturnType<typeof setup>,prof:Awaited<ReturnType<typeof login>>,m:MediaMaterial,count=3) {const body={material_ids:[m.material_id],question_count:count},key=randomUUID();const receipt=(await prof.post(base+'/quiz-drafts').set('Idempotency-Key',key).send(body).expect(202)).body;await app.waitForJobs();return {receipt,key,body,job:(await prof.get('/api/jobs/'+receipt.job_id)).body}}
describe('YouTube 퀴즈·교수 검토·학생 오답 (생성은 명시적 대역)',()=> {
 it('선택 게시·정답 비노출·서버 채점·개인 오답·시간 출처·레포트·재시작을 연결한다',async()=> {
  const spy=vi.fn(fake),app=setup(spy),m=material();save(app,m);const prof=await login(app),student=await login(app,IDS.student),other=await login(app,IDS.student2),outsider=await login(app,IDS.outsider);
  const {receipt,key,body,job}=await generate(app,prof,m);expect(job.status).toBe('completed');const draft=(await prof.get('/api/quiz-drafts/'+job.result.draft_id).expect(200)).body;
  expect((await prof.post(base+'/quiz-drafts').set('Idempotency-Key',key).send(body)).body.job_id).toBe(receipt.job_id);expect(spy).toHaveBeenCalledTimes(1);
  expect(draft.questions).toHaveLength(3);expect(draft.questions[0].sources[0]).toMatchObject({origin:'youtube',slide_no:null,start_sec:732,end_sec:780});expect(JSON.stringify(spy.mock.calls)).not.toContain('XwsPTAnFRsk');
  await student.get('/api/quiz-drafts/'+draft.draft_id).expect(403);await student.post(base+'/quiz-drafts').set('Idempotency-Key',randomUUID()).send(body).expect(403);
  const selected=[draft.questions[0],draft.questions[2]],posted=(await prof.post(`/api/quiz-drafts/${draft.draft_id}/publish`).set('Idempotency-Key',randomUUID()).send({question_ids:selected.map(q=>q.question_id)}).expect(201)).body;
  const quiz=(await student.get('/api/quizzes/'+posted.quiz_id)).body;expect(quiz.questions).toHaveLength(2);expect(JSON.stringify(quiz)).not.toMatch(/sources|correct_option_id|explanation/);
  const answers={answers:selected.map((q,i)=>({question_id:q.question_id,option_id:i?'b':'a'}))},attemptKey=randomUUID();const result=(await student.post(`/api/quizzes/${posted.quiz_id}/attempts`).set('Idempotency-Key',attemptKey).send(answers).expect(201)).body;
  expect(result).toMatchObject({correct_count:1,total_count:2});expect(result.wrong_questions).toHaveLength(1);expect(result.wrong_questions[0]).toMatchObject({correct_option_id:'a',selected_option_id:'b',sources:[expect.objectContaining({origin:'youtube',slide_no:null})]});expect(JSON.stringify(result)).not.toContain('XwsPTAnFRsk');
  expect((await student.post(`/api/quizzes/${posted.quiz_id}/attempts`).set('Idempotency-Key',attemptKey).send(answers)).body.attempt_id).toBe(result.attempt_id);await student.post(`/api/quizzes/${posted.quiz_id}/attempts`).set('Idempotency-Key',randomUUID()).send(answers).expect(409);
  await student.get(`/api/materials/${m.material_id}/playback`).expect(403);await prof.get(`/api/materials/${m.material_id}/playback?start=732`).expect(302);await outsider.get('/api/quizzes/'+posted.quiz_id).expect(403);expect((await other.get('/api/me/attempts')).body).toHaveLength(0);
  const report=(await prof.get(`/api/courses/${IDS.course}/reports/quizzes`)).body;expect(report.summary).toMatchObject({participation_rate:.5,correct_rate:.5});expect(report.weeks[0].questions[0].sources[0].origin).toBe('youtube');
  const item=resources.find(r=>r.app===app)!;await app.close();resources.splice(resources.indexOf(item),1);const restarted=setup(fake,{},item.dir),returning=await login(restarted,IDS.student);expect((await returning.get('/api/me/attempts')).body[0]).toEqual(result);
 });
 it('50문항 배치 생성과 긴 범위 전체 근거 전달을 검증한다',async()=> {
  const m=material(),spy=vi.fn(fake);expect(await generateYouTubeQuestions(m,50,spy)).toHaveLength(50);expect(spy).toHaveBeenCalledTimes(7);expect(spy.mock.calls.every(call=>call[1]<=8)).toBe(true);
  const long={...m,duration_sec:7200,youtube:{...m.youtube!,start_sec:0,end_sec:7200},segments:Array.from({length:30},(_,i)=>({start_sec:i*61,end_sec:i*61+50,text:('개념 '+i+' ').repeat(150)}))};
  const sent=vi.fn(fake);await generateYouTubeQuestions(long,2,sent);const expected=materialPassages([long],long.course_id,long.week_id).map(p=>p.source.chunk_id);expect(new Set(sent.mock.calls.flatMap(call=>call[0].map(p=>p.source.chunk_id)))).toEqual(new Set(expected));
  await expect(generateYouTubeQuestions(long,1,fake)).rejects.toMatchObject({code:'RANGE_TOO_LARGE'});
 });
 it('환각 근거 ID·위조 시간·중복 보기·문항 수 불일치·근거 부족을 거부한다',()=> {
  const passages=materialPassages([material()],IDS.course,IDS.week),q={prompt:'강의의 핵심 개념은 무엇인가요?',options:['하나','둘','셋','넷'],correct_index:0,explanation:'자료에서 이 개념을 설명합니다.',source_ids:[passages[0].source.chunk_id]};
  for(const changed of [{...q,source_ids:[randomUUID()]},{...q,start_sec:0},{...q,options:['하나','하나','셋','넷']}])expect(()=>validateTranscriptQuestions({questions:[changed],insufficient_evidence:false},passages,1)).toThrow();
  expect(()=>validateTranscriptQuestions({questions:[q],insufficient_evidence:false},passages,2)).toThrow();
  expect(()=>validateTranscriptQuestions({questions:[],insufficient_evidence:true},passages,1)).toThrowError(expect.objectContaining({code:'INSUFFICIENT_QUIZ_EVIDENCE'}));
 });
 it('후속 배치가 실패하면 일부 초안을 저장하지 않고 실패 이유를 보존한다',async()=> {
  const generator=vi.fn<TranscriptGenerator>().mockImplementationOnce(fake).mockRejectedValueOnce(new HttpError(422,'INSUFFICIENT_QUIZ_EVIDENCE','출제 근거가 부족합니다.'));
  const app=setup(generator),m=material();save(app,m);const prof=await login(app),result=await generate(app,prof,m,9);expect(result.job.status).toBe('failed');expect(result.job.error.code).toBe('INSUFFICIENT_QUIZ_EVIDENCE');expect((await prof.get(base+'/content')).body.drafts).toHaveLength(0);
 });
 it('완료 전·다른 주차·허용되지 않은 로컬 미디어를 출제하지 않는다',async()=> {
  const generator=vi.fn(fake),app=setup(generator),prof=await login(app),m=material();save(app,{...m,status:'processing'});
  const requestBody={material_ids:[m.material_id],question_count:3};await prof.post(base+'/quiz-drafts').set('Idempotency-Key',randomUUID()).send(requestBody).expect(409);
  app.store.run('UPDATE materials SET week_id=?, data=? WHERE id=?',IDS.week2,JSON.stringify({...m,week_id:IDS.week2}),m.material_id);await prof.post(base+'/quiz-drafts').set('Idempotency-Key',randomUUID()).send(requestBody).expect(422);
  app.store.run('UPDATE materials SET week_id=?, data=? WHERE id=?',IDS.week,JSON.stringify({...m,youtube:undefined}),m.material_id);await prof.post(base+'/quiz-drafts').set('Idempotency-Key',randomUUID()).send(requestBody).expect(422);expect(generator).not.toHaveBeenCalled();
 });
 it('선택 범위 밖 전사나 중복 문제를 성공 초안으로 처리하지 않는다',async()=> {
  const m=material(),spy=vi.fn(fake);await expect(generateYouTubeQuestions({...m,segments:[{start_sec:0,end_sec:50,text:'범위 밖 근거'}]},1,spy)).rejects.toMatchObject({code:'INVALID_TRANSCRIPT'});expect(spy).not.toHaveBeenCalled();
  const duplicate:TranscriptGenerator=async(p,n)=>(await fake(p,1)).flatMap(q=>Array(n).fill(q));await expect(generateYouTubeQuestions(m,2,duplicate)).rejects.toMatchObject({code:'DUPLICATE_QUESTIONS'});
 });
 it('키 누락·미지원 제공자를 작업 성공이나 다른 모델 호출로 바꾸지 않는다',async()=> {
  for(const overrides of [{transcriptGenerator:undefined},{transcriptGenerator:undefined,provider:'gemini' as const,apiKey:'test-only-key'}]) {
   const app=setup(fake,overrides),prof=await login(app),m=material();save(app,m);const response=await prof.post(base+'/quiz-drafts').set('Idempotency-Key',randomUUID()).send({material_ids:[m.material_id],question_count:1}).expect(503);expect(['AI_NOT_CONFIGURED','YOUTUBE_QUIZ_PROVIDER_UNSUPPORTED']).toContain(response.body.code);expect(app.store.all('SELECT id FROM jobs')).toHaveLength(0);
  }
 });
 it('공식 Claude SDK에 시간 근거 ID를 보내고 페이지·URL을 생성 출력으로 받지 않는다',async()=> {
  const passages=materialPassages([material()],IDS.course,IDS.week),questions=await fake(passages,1);
  const http=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({id:'msg_test',type:'message',role:'assistant',model:'claude-sonnet-5-5',content:[{type:'text',text:JSON.stringify({questions,insufficient_evidence:false})}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:10}}),{status:200,headers:{'content-type':'application/json'}}));
  const generate=createClaudeTranscriptGenerator({apiKey:'test-only-key',transport:http});expect(await generate(passages,1)).toEqual(questions);const body=JSON.parse(String(http.mock.calls[0][1]?.body));expect(body.tools).toBeUndefined();expect(body.output_config.format.type).toBe('json_schema');expect(JSON.stringify(body)).not.toContain('https://www.youtube.com');expect(JSON.stringify(body)).toContain(passages[0].source.chunk_id);
 });
});
