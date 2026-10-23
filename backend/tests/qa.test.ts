import {afterEach,describe,expect,it,vi} from 'vitest';
import request from 'supertest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {IDS} from '../src/store.js';
import type {Material} from '../src/types.js';
import type {Decision,Judge,QAGenerator,QAThread} from '../src/qa/types.js';
import {createJevJudge} from '../src/qa/jev.js';
import {retrieve} from '../src/retrieval/local-search.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const base=`/api/courses/${IDS.course}/weeks/${IDS.week}/threads`;
const resources:{app:ReturnType<typeof createApp>;dir:string}[]=[];
afterEach(async()=>{for(const r of resources.splice(0)){await r.app.close();rmSync(r.dir,{recursive:true,force:true})}});
function decision(clear=true,enough=true):Decision{return {model:'jev-test',clarity:{label:clear?'clear':'unclear',confidence:.98,probabilities:{clear:clear?.98:.02,unclear:clear?.02:.98}},evidence:{label:enough?'sufficient':'insufficient',confidence:.98,probabilities:{sufficient:enough?.98:.02,insufficient:enough?.02:.98}}}}
const generate:QAGenerator=async input=>input.mode==='clarification'?{text:'어떤 강의 개념을 질문하시는지 알려 주실 수 있나요?',source_ids:[]}:{text:'정규화는 데이터 중복을 줄이는 과정입니다.',source_ids:[input.passages[0].source.chunk_id]};
function setup(judge?:Judge,generator:QAGenerator=generate) {
 const dir=mkdtempSync(resolve(tmpdir(),'campus-qa-'));
 const service=createApp({root,dataDir:dir,demoAuth:true,qaJudge:judge,qaGenerator:generator});resources.push({app:service,dir});
 const material:Material={material_id:randomUUID(),course_id:IDS.course,week_id:IDS.week,name:'fixture.pdf',slide_start:2,slide_end:3,status:'completed',total_slides:4,original_visible_to_students:false,file_path:'/not-public',slides:[{slide_no:1,text:'범위 밖 비밀 정답입니다.'},{slide_no:2,text:'정규화는 데이터 중복을 줄이는 과정입니다. 기본키는 행을 식별합니다.'},{slide_no:3,text:'트랜잭션은 하나의 논리적 작업 단위입니다.'}]};
 service.store.run('INSERT INTO materials VALUES (?,?,?,?)',material.material_id,material.course_id,material.week_id,JSON.stringify(material));
 return service;
}
async function login(service:ReturnType<typeof setup>,user=IDS.student){const agent=request.agent(service.app);await agent.post('/api/dev/login').send({user_id:user}).expect(200);return agent}
async function ask(service:ReturnType<typeof setup>,student:Awaited<ReturnType<typeof login>>,text='정규화란 무엇인가요?') {
 const posted=await student.post(base).set('Idempotency-Key',randomUUID()).send({text}).expect(201);await service.waitForJobs();return (await student.get('/api/threads/'+posted.body.thread_id).expect(200)).body as QAThread;
}
describe('Q&A 서버 상태와 접근 권한',()=> {
 it('강의 자료를 검색하고 Jev 판단 뒤 출처 있는 답변을 반환하며 내부 기록을 숨긴다',async()=> {
  const judge=vi.fn(async()=>decision());const service=setup(judge),student=await login(service);const t=await ask(service,student);
  expect(t.state).toBe('resolved');expect(t.messages.at(-1)?.sources[0].slide_no).toBe(2);expect(judge).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(t)).not.toMatch(/decisions|attempt_count|file_path|probabilities/);
  await student.get(`/api/threads/${t.thread_id}/decisions`).expect(403);
  const professor=await login(service,IDS.professor);const logs=await professor.get(`/api/threads/${t.thread_id}/decisions`).expect(200);expect(logs.body[0].decision.model).toBe('jev-test');
 });
 it('추가 질문은 1회만 보내고 보완 답변을 재검색·재판단하며 중복 제출을 합친다',async()=> {
  const judge=vi.fn(async()=>decision(false,false));const generation=vi.fn(generate);const service=setup(judge,generation),student=await login(service);
  const initial=await ask(service,student,'이거 설명해 주세요.');expect(initial.state).toBe('awaiting_student');expect(initial.clarification_count).toBe(1);
  const payload={text:'그거요.',expected_version:initial.version};
  const first=await student.post(`/api/threads/${initial.thread_id}/messages`).set('Idempotency-Key','same-followup').send(payload).expect(202);
  await student.post(`/api/threads/${initial.thread_id}/messages`).set('Idempotency-Key','same-followup').send(payload).expect(202);
  await student.post(`/api/threads/${initial.thread_id}/messages`).set('Idempotency-Key','different-key').send(payload).expect(409);
  await service.waitForJobs();const latest=(await student.get('/api/threads/'+initial.thread_id)).body as QAThread;
  expect(latest.state).toBe('awaiting_professor');expect(latest.clarification_count).toBe(1);expect(latest.messages.filter(m=>m.kind==='clarification')).toHaveLength(1);expect(judge).toHaveBeenCalledTimes(2);expect(generation).toHaveBeenCalledTimes(1);
  const professor=await login(service,IDS.professor);await professor.post(`/api/threads/${initial.thread_id}/messages`).set('Idempotency-Key','professor-answer').send({text:'질문한 개념은 수업 시간에 예시로 함께 설명하겠습니다.',expected_version:latest.version}).expect(200);
  const resolved=(await student.get('/api/threads/'+initial.thread_id)).body;expect(resolved.state).toBe('resolved');expect(resolved.messages.at(-1).author_role).toBe('professor');
 });
 it('보완 답변으로 명확해지면 새 질의로 검색하여 교수 승격 없이 답한다',async()=> {
  const judge=vi.fn<Judge>().mockResolvedValueOnce(decision(false,false)).mockResolvedValueOnce(decision(true,true));const service=setup(judge),student=await login(service);
  const t=await ask(service,student,'이거가 뭔가요?');
  await student.post(`/api/threads/${t.thread_id}/messages`).set('Idempotency-Key','specific-followup').send({text:'정규화의 의미를 질문했습니다.',expected_version:t.version}).expect(202);await service.waitForJobs();
  const final=(await student.get('/api/threads/'+t.thread_id)).body;expect(final.state).toBe('resolved');expect(final.clarification_count).toBe(1);expect(judge.mock.calls[1][0].passages[0].text).toContain('정규화');
 });
 it('명확하지만 근거가 부족하면 추가 질문 없이 교수님에게 넘긴다',async()=> {
  const generation=vi.fn(generate);const service=setup(async()=>decision(true,false),generation),student=await login(service);const t=await ask(service,student,'DNA 복제 과정을 알려 주세요.');
  expect(t.state).toBe('awaiting_professor');expect(t.handoff_reason).toBe('insufficient_evidence');expect(t.clarification_count).toBe(0);expect(generation).not.toHaveBeenCalled();
 });
 it('다른 학생·강의 접근과 교수님의 임의 학생 행세를 차단한다',async()=> {
  const service=setup(async()=>decision(true,false)),student=await login(service),other=await login(service,IDS.student2),outsider=await login(service,IDS.outsider),professor=await login(service,IDS.professor);
  const t=await ask(service,student);await other.get('/api/threads/'+t.thread_id).expect(403);await outsider.get('/api/threads/'+t.thread_id).expect(403);
  expect((await other.get(base)).body).toHaveLength(0);expect((await professor.get(base)).body).toHaveLength(1);
  await professor.post(base).set('Idempotency-Key','no-impersonation').send({text:'학생 대신 질문합니다.'}).expect(403);
  await student.post(`/api/threads/${t.thread_id}/messages`).set('Idempotency-Key','no-professor').send({text:'교수 답변을 흉내 냅니다.',expected_version:t.version}).expect(422);
 });
 it('Jev 키 누락은 승격이 아니라 오류로 남기고 재시도해도 추가 질문을 만들지 않는다',async()=> {
  const service=setup(),student=await login(service);const t=await ask(service,student);
  expect(t.state).toBe('open');expect(t.processing_status).toBe('failed');expect(t.error?.code).toBe('JEV_NOT_CONFIGURED');expect(t.clarification_count).toBe(0);
  await student.post(`/api/threads/${t.thread_id}/retry`).set('Idempotency-Key','retry').send({expected_version:t.version}).expect(202);await service.waitForJobs();
  const retried=(await student.get('/api/threads/'+t.thread_id)).body;expect(retried.state).toBe('open');expect(retried.clarification_count).toBe(0);expect(retried.messages).toHaveLength(1);
 });
 it('응답 생성 실패 후 재시도해도 추가 질문 전송 횟수와 메시지를 중복하지 않는다',async()=> {
  const generation=vi.fn<QAGenerator>().mockRejectedValueOnce(new Error('offline')).mockImplementation(generate);
  const service=setup(async()=>decision(false,false),generation),student=await login(service);const t=await ask(service,student,'그게 뭐예요?');
  expect(t.processing_status).toBe('failed');expect(t.clarification_count).toBe(0);
  await student.post(`/api/threads/${t.thread_id}/retry`).set('Idempotency-Key','retry-generator').send({expected_version:t.version}).expect(202);await service.waitForJobs();
  const updated=(await student.get('/api/threads/'+t.thread_id)).body;expect(updated.clarification_count).toBe(1);expect(updated.messages.filter((m:{kind:string})=>m.kind==='clarification')).toHaveLength(1);
 });
 it('불확실한 판단 또는 출처 없는 생성 응답은 교수님에게 연결한다',async()=> {
  const uncertain=decision();uncertain.clarity.confidence=.5;const first=setup(async()=>uncertain),student=await login(first);expect((await ask(first,student)).handoff_reason).toBe('judgment_uncertain');
  const second=setup(async()=>decision(),async()=>({text:'근거를 찾을 수 없습니다.',source_ids:[]})),other=await login(second);expect((await ask(second,other)).handoff_reason).toBe('answer_not_grounded');
 });
 it('대화·상태·판단 기록을 재시작 후 보존한다',async()=> {
  const service=setup(async()=>decision(false,false)),student=await login(service);const t=await ask(service,student,'이거요');
  const i=resources.findIndex(r=>r.app===service),dir=resources[i].dir;await service.close();resources.splice(i,1);
  const restarted=createApp({root,dataDir:dir,demoAuth:true,qaJudge:async()=>decision(),qaGenerator:generate});resources.push({app:restarted,dir});
  const returning=await login(restarted);const saved=(await returning.get('/api/threads/'+t.thread_id)).body;expect(saved.state).toBe('awaiting_student');expect(saved.clarification_count).toBe(1);
 });
});
describe('주차 검색 경계',()=> {
 it('다른 강의·주차·처리 중 자료와 선택 범위 밖 페이지를 제외한다',()=> {
  const material:Material={material_id:randomUUID(),course_id:IDS.course,week_id:IDS.week,name:'private.pdf',slide_start:2,slide_end:2,status:'completed',total_slides:3,original_visible_to_students:false,file_path:'/not-public',slides:[{slide_no:1,text:'정규화 범위 밖 비밀'},{slide_no:2,text:'정규화는 중복을 줄인다.'},{slide_no:3,text:'정규화 범위 밖 끝'}]};
  const passages=retrieve([material,{...material,material_id:randomUUID(),course_id:IDS.otherCourse},{...material,material_id:randomUUID(),week_id:IDS.week2},{...material,material_id:randomUUID(),status:'processing'}],IDS.course,IDS.week,'정규화');
  expect(passages).toHaveLength(1);expect(passages[0].source.material_id).toBe(material.material_id);expect(passages[0].source.slide_no).toBe(2);expect(passages[0].text).not.toContain('비밀');
 });
});
describe('Jev 실제 SDK 프로토콜과 오류 (외부 HTTP는 테스트 대역)',()=> {
 const response={model:'jev-1.13.0',answers:{clarity:{type:'choice',choice:'clear',confidence:.99,probabilities:{clear:.99,unclear:.01}},evidence:{type:'choice',choice:'sufficient',confidence:.99,probabilities:{sufficient:.99,insufficient:.01}}},usage:{input_tokens:100,output_tokens:0}};
 it('공식 SDK로 두 판단을 함께 요청하고 버전·확률을 읽는다',async()=> {
  const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response),{status:200,headers:{'content-type':'application/json'}}));
  const judge=createJevJudge('test-only-key','jev-1.13.0',transport);const result=await judge({messages:[],passages:[]});
  expect(result.model).toBe('jev-1.13.0');expect(result.clarity.label).toBe('clear');expect(result.evidence.probabilities.sufficient).toBe(.99);expect(transport).toHaveBeenCalledTimes(1);
 });
 it('인증 실패를 근거 부족으로 바꾸지 않으며 자동 재시도하지 않는다',async()=> {
  const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({error:{message:'invalid credentials'}}),{status:401,headers:{'content-type':'application/json'}}));
  await expect(createJevJudge('test-only-key','jev-1.13.0',transport)({messages:[],passages:[]})).rejects.toMatchObject({code:'JEV_AUTH_FAILED'});expect(transport).toHaveBeenCalledTimes(1);
 });
});
