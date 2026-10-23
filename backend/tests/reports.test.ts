import {afterEach,describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {IDS} from '../src/store.js';
import type {DraftQuestion} from '../src/types.js';
import type {StoredThread} from '../src/qa/types.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const resources:{app:ReturnType<typeof createApp>;dir:string}[]=[];
afterEach(async()=>{for(const r of resources.splice(0)){await r.app.close();rmSync(r.dir,{recursive:true,force:true})}});
function setup() {
 const dir=mkdtempSync(resolve(tmpdir(),'campus-reports-'));
 const judge=vi.fn(async()=>{throw new Error('Reports must not call AI')});
 const app=createApp({root,dataDir:dir,demoAuth:true,qaJudge:judge});resources.push({app,dir});return {...app,judge};
}
type App=ReturnType<typeof setup>;
const path=`/api/courses/${IDS.course}/reports`;
async function login(app:App,user=IDS.professor){const agent=request.agent(app.app);await agent.post('/api/dev/login').send({user_id:user}).expect(200);return agent}
function quiz(app:App,week:string,count:number) {
 const draft_id=randomUUID(),quiz_id=randomUUID();
 const questions:DraftQuestion[]=Array.from({length:count},(_,i)=>({question_id:randomUUID(),prompt:`정규화 개념 ${i+1}번을 확인합니다.`,options:['정규화','중복 저장','삭제','정렬'].map((text,j)=>({option_id:String.fromCharCode(97+j),text})),correct_option_id:'a',explanation:'정규화는 데이터 중복을 줄입니다.',sources:[{material_id:randomUUID(),chunk_id:randomUUID(),source_type:'document',slide_no:2,start_sec:null,end_sec:null}]}));
 app.store.run('INSERT INTO drafts VALUES (?,?,?,?)',draft_id,IDS.course,week,JSON.stringify({draft_id,week_id:week,questions}));
 app.store.run('INSERT INTO quizzes VALUES (?,?,?,?,?)',quiz_id,draft_id,IDS.course,week,JSON.stringify({quiz_id,week_id:week,questions}));return {quiz_id,questions};
}
async function submit(agent:Awaited<ReturnType<typeof login>>,q:ReturnType<typeof quiz>,answers:string[],key=randomUUID()) {
 return agent.post(`/api/quizzes/${q.quiz_id}/attempts`).set('Idempotency-Key',key).send({answers:q.questions.map((question,i)=>({question_id:question.question_id,option_id:answers[i]}))}).expect(201);
}
function thread(app:App,week:string,options:Partial<StoredThread>={}) {
 const now=new Date().toISOString();
 const value:StoredThread={thread_id:randomUUID(),course_id:IDS.course,week_id:week,student_id:IDS.student,student_name:'학생 가',state:'resolved',clarification_count:0,processing_status:'idle',version:2,messages:[{message_id:randomUUID(),author_role:'student',kind:'question',text:'정규화가 무엇인가요?',sources:[],created_at:now}],error:null,handoff_reason:null,created_at:now,updated_at:now,attempt_count:1,decisions:[{at:now,attempt:1,decision:{model:'internal-only-model',clarity:{label:'clear',confidence:1,probabilities:{clear:1,unclear:0}},evidence:{label:'sufficient',confidence:1,probabilities:{sufficient:1,insufficient:0}}},source_ids:[],route:'answer'}],...options};
 app.store.run('INSERT INTO threads VALUES (?,?,?,?,?)',value.thread_id,value.course_id,value.week_id,value.student_id,JSON.stringify(value));return value;
}
describe('교수 레포트의 계산과 권한',()=> {
 it('여러 퀴즈의 참여자를 중복 없이 세고 전체 정답률을 제출 답안 수로 가중한다',async()=> {
  const app=setup(),professor=await login(app),a=await login(app,IDS.student),b=await login(app,IDS.student2);
  const first=quiz(app,IDS.week,2),second=quiz(app,IDS.week,1),third=quiz(app,IDS.week2,1);
  const key=randomUUID();await submit(a,first,['a','b'],key);await submit(a,first,['a','b'],key);await submit(b,first,['a','a']);await submit(a,second,['b']);await submit(a,third,['b']);
  const report=(await professor.get(path+'/quizzes').expect(200)).body;
  expect(report.weeks[0]).toMatchObject({quiz_count:2,participant_count:2,eligible_student_count:2,participation_rate:1,submission_count:3,correct_count:3,answer_count:5,correct_rate:.6});
  expect(report.weeks[0].questions.map((q:{correct_rate:number})=>q.correct_rate)).toEqual([1,.5,0]);
  expect(report.weeks[1]).toMatchObject({participant_count:1,participation_rate:.5,correct_rate:0});
  expect(report.summary).toMatchObject({participant_count:2,participation_rate:1,correct_count:3,answer_count:6,correct_rate:.5,submission_count:4});
  expect(report.weeks[0].questions[0]).toMatchObject({quiz_id:first.quiz_id,quiz_no:1,question_no:1,correct_option_id:'a'});
 });
 it('주차 선택·중복 UUID를 처리하고 다른 강의 주차·잘못된 필터를 거부한다',async()=> {
  const app=setup(),professor=await login(app);quiz(app,IDS.week,2);quiz(app,IDS.week2,1);
  const report=(await professor.get(path+`/quizzes?week_ids=${IDS.week2},${IDS.week2}`).expect(200)).body;expect(report.weeks).toHaveLength(1);expect(report.summary.question_count).toBe(1);
  for(const suffix of ['/quizzes?week_ids=','/quizzes?week_ids=not-a-uuid',`/quizzes?week_ids=${IDS.week},`,'/qa?page=0','/qa?page_size=101'])await professor.get(path+suffix).expect(422);
  const other=randomUUID();app.store.run('INSERT INTO weeks VALUES (?,?,?,?)',other,IDS.otherCourse,1,'다른 강의 주차');
  await professor.get(path+'/quizzes?week_ids='+other).expect(404);await professor.get(path+'/qa?week_ids='+other).expect(404);
 });
 it('미게시·미제출·수강생 0명을 정답률 0%와 구분하고 현재 수강생으로 분모와 제출을 맞춘다',async()=> {
  const app=setup(),professor=await login(app);
  let report=(await professor.get(path+'/quizzes').expect(200)).body;expect(report.summary.participation_rate).toBeNull();expect(report.summary.correct_rate).toBeNull();
  const q=quiz(app,IDS.week,1);report=(await professor.get(path+'/quizzes').expect(200)).body;expect(report.weeks[0].participation_rate).toBe(0);expect(report.weeks[0].correct_rate).toBeNull();
  const a=await login(app,IDS.student);await submit(a,q,['b']);
  report=(await professor.get(path+'/quizzes').expect(200)).body;expect(report.weeks[0].correct_rate).toBe(0);expect(report.weeks[0].participation_rate).toBe(.5);
  app.store.run('DELETE FROM memberships WHERE course_id=? AND role=?',IDS.course,'student');
  report=(await professor.get(path+'/quizzes').expect(200)).body;expect(report.summary).toMatchObject({eligible_student_count:0,participant_count:0,participation_rate:null,correct_rate:null,answer_count:0});
 });
 it('학생·비로그인·다른 강의 교수에게 정답과 대화를 공개하지 않는다',async()=> {
  const app=setup(),student=await login(app,IDS.student),outsider=await login(app,IDS.outsider),professor=await login(app);quiz(app,IDS.week,1);thread(app,IDS.week);
  for(const report of ['quizzes','qa']) {
   await request(app.app).get(path+'/'+report).expect(401);await student.get(path+'/'+report).expect(403);await outsider.get(path+'/'+report).expect(403);
   await professor.get(`/api/courses/${IDS.otherCourse}/reports/${report}`).expect(403);
  }
  // 다른 강의의 교수여도 이 강의 소속이 아니면 조회할 수 없다.
  app.store.run('UPDATE memberships SET role=? WHERE user_id=? AND course_id=?','professor',IDS.outsider,IDS.otherCourse);
  await outsider.get(path+'/qa').expect(403);const own=(await outsider.get(`/api/courses/${IDS.otherCourse}/reports/qa`).expect(200)).body;expect(own.summary.thread_count).toBe(0);
 });
 it('Q&Aは100件を超えても全件を集計し、ページと主質問・会話を取得して内部判定を隠す',async()=> {
  const app=setup(),professor=await login(app);
  for(let i=0;i<105;i++)thread(app,IDS.week,i===0?{state:'open',processing_status:'failed',error:{code:'JEV_UNAVAILABLE',message:'연결할 수 없습니다.',retryable:true}}:{});
  thread(app,IDS.week2,{student_id:IDS.student2,student_name:'학생 나',state:'awaiting_professor',handoff_reason:'insufficient_evidence',clarification_count:1});
  const other=randomUUID();app.store.run('INSERT INTO weeks VALUES (?,?,?,?)',other,IDS.otherCourse,1,'다른 주차');thread(app,other,{course_id:IDS.otherCourse,student_id:IDS.outsider});
  const all=(await professor.get(path+'/qa?page=5&page_size=25').expect(200)).body;
  expect(all).toMatchObject({total_count:106,page:5,page_count:5});expect(all.threads).toHaveLength(6);expect(all.summary).toMatchObject({thread_count:106,questioning_student_count:2,resolved_count:104,open_count:1,error_count:1,awaiting_professor_count:1,clarified_thread_count:1});
  expect(all.threads[0].messages[0].text).toBe('정규화가 무엇인가요?');expect(JSON.stringify(all.threads)).not.toMatch(/decisions|student_id|attempt_count|probabilities|internal-only-model/);
  const selected=(await professor.get(path+`/qa?week_ids=${IDS.week2}`).expect(200)).body;expect(selected.total_count).toBe(1);expect(selected.threads[0].student_name).toBe('학생 나');
  expect(app.judge).not.toHaveBeenCalled();
 });
 it('조회할 때 새 제출·대화 상태 변경을 반영하고 필터가 다른 주차로 섞이지 않는다',async()=> {
  const app=setup(),professor=await login(app),student=await login(app,IDS.student);const q=quiz(app,IDS.week,1);
  const first=(await professor.get(path+'/quizzes?week_ids='+IDS.week2).expect(200)).body;expect(first.summary.quiz_count).toBe(0);
  await submit(student,q,['a']);const t=thread(app,IDS.week,{state:'awaiting_professor',handoff_reason:'insufficient_evidence'});
  await professor.post(`/api/threads/${t.thread_id}/messages`).set('Idempotency-Key',randomUUID()).send({text:'정규화는 중복을 줄이는 설계입니다.',expected_version:t.version}).expect(200);
  const qa=(await professor.get(path+'/qa').expect(200)).body;expect(qa.summary.resolved_count).toBe(1);expect(qa.threads[0].messages.at(-1).author_role).toBe('professor');
  const fresh=await professor.get(path+'/quizzes').expect(200);expect(fresh.body.summary.correct_rate).toBe(1);expect(fresh.headers['cache-control']).toBe('no-store');
 });
});
