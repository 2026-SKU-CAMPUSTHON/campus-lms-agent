import {afterEach,beforeAll,describe,expect,it} from 'vitest';
import request from 'supertest';
import {mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {MySQLDatabase} from '../src/mysql.js';
import {createApp} from '../src/app.js';
import {bootstrapProfessor,tokenHash} from '../src/auth/routes.js';
import type {PublicQuiz,QuizDraft} from '../src/types.js';
import type {Decision} from '../src/qa/types.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const url=process.env.MYSQL_TEST_URL;
const password='Integration-password-2026';
const resources:{close:()=>Promise<void>;dir:string}[]=[];
afterEach(async()=>{for(const resource of resources.splice(0)){await resource.close();rmSync(resource.dir,{recursive:true,force:true})}});
const decision=(clear:boolean):Decision=>({model:'jev-test',clarity:{label:clear?'clear':'unclear',confidence:.99,probabilities:{clear:clear?.99:.01,unclear:clear?.01:.99}},evidence:{label:'sufficient',confidence:.99,probabilities:{sufficient:.99,insufficient:.01}}});
const dependencies={
 generator:async(slides:{slide_no:number;text:string}[],count:number)=>Array.from({length:count},(_,i)=>({prompt:`정규화의 목적은 무엇인가요? ${i+1}`,options:['중복 감소','중복 증가','자료 삭제','무작위 복제'],correct_index:0,explanation:'정규화는 데이터 중복을 줄입니다.',slide_nos:[slides[0].slide_no]})),
 qaJudge:async(input:{messages:{text:string}[]})=>decision(!input.messages[0].text.includes('모호')),
 qaGenerator:async(input:{mode:'answer'|'clarification';passages:{source:{chunk_id:string}}[]})=>input.mode==='clarification'?{text:'어떤 개념인지 알려 주세요.',source_ids:[]}:{text:'정규화는 중복을 줄입니다.',source_ids:input.passages.slice(0,1).map(p=>p.source.chunk_id)},
 youtubeImporter:async()=>({name:'MySQL 검증 강의',method:'captions' as const,is_generated:true,transcription:{duration_sec:100,language:'ko',segments:[{start_sec:0,end_sec:60,text:'정규화는 데이터 중복을 줄입니다.'}]}}),
};
async function setup(production=false) {
 if(!url||new URL(url).pathname!=='/campus_test')throw new Error('MYSQL_TEST_URL must identify the disposable campus_test database.');
 const db=new MySQLDatabase(url);await db.migrate(root);
 for(const table of ['course_invites','auth_credentials','idempotency','threads','jobs','attempts','quizzes','drafts','materials','sessions','memberships','weeks','courses','users'])await db.run(`DELETE FROM ${table}`);
 const bootstrap=await bootstrapProfessor(db,{email:'teacher@example.test',password,name:'실제 계정 교수',courseTitle:'MySQL 통합 강의'});
 const dir=mkdtempSync(resolve(tmpdir(),'campus-mysql-')),service=createApp({root,dataDir:dir,demoAuth:false,database:db,production,publicOrigin:production?'https://campus.example.test':undefined,...dependencies});
 resources.push({close:()=>service.close(),dir});await service.initialized;
 const professor=request.agent(service.app);const logged=await professor.post('/api/auth/login').send({email:'teacher@example.test',password}).expect(200);
 const course=bootstrap.course_id!,weeks=(await professor.get(`/api/courses/${course}/weeks`).expect(200)).body;
 return {db,service,professor,course,week:weeks[0].week_id as string,dir,cookie:logged.headers['set-cookie']};
}
async function invite(ctx:Awaited<ReturnType<typeof setup>>,role='student') {return (await ctx.professor.post(`/api/courses/${ctx.course}/invites`).send({role}).expect(201)).body.invite_code as string}
async function student(ctx:Awaited<ReturnType<typeof setup>>,name='학생 가') {
 const agent=request.agent(ctx.service.app),code=await invite(ctx);
 const result=await agent.post('/api/auth/register').send({email:`${randomUUID()}@example.test`,password,name,invite_code:code}).expect(201);
 return {agent,user:result.body,code,cookie:(result.headers['set-cookie'] as unknown as string[])[0].split(';')[0]};
}
describe.skipIf(!url)('MySQL 8.4 실제 연결: 계정·초대·저장·권한·재시작',()=> {
 beforeAll(()=>execFileSync('python3',[resolve(root,'scripts/create-sample-pdf.py')]));
 it('체험 계정 없이 로그인하고 해시·서버 세션을 저장하며 로그아웃 시 무효화한다',async()=> {
  const ctx=await setup(),{agent,user}=await student(ctx);
  expect((await ctx.db.get<{n:number}>('SELECT COUNT(*) AS n FROM users'))!.n).toBe(2);
  expect((await agent.get('/api/courses').expect(200)).body[0].role).toBe('student');
  await request(ctx.service.app).get('/api/dev/accounts').expect(404);await request(ctx.service.app).post('/api/dev/login').send({user_id:user.user_id}).expect(404);
  for(const email of ['teacher@example.test','unknown@example.test'])await request(ctx.service.app).post('/api/auth/login').send({email,password:'wrong-password'}).expect(401);
  await request(ctx.service.app).post('/api/auth/login').send({email:"' OR 1=1 --@example.test",password}).expect(422);
  await request(ctx.service.app).get('/api/me').set('Cookie','campus_session=forged').expect(401);
  const credential=await ctx.db.get<{password_hash:string}>('SELECT password_hash FROM auth_credentials WHERE user_id=?',user.user_id);
  expect(credential!.password_hash).toMatch(/^scrypt-v1\$/);expect(credential!.password_hash).not.toContain(password);
  await agent.post('/api/logout').send({}).expect(204);await agent.get('/api/me').expect(401);
  const before=await ctx.db.get<{password_hash:string}>('SELECT password_hash FROM auth_credentials WHERE email=?','teacher@example.test');
  expect((await bootstrapProfessor(ctx.db,{email:'teacher@example.test',password:'A-different-password-2026',name:'변경',courseTitle:'변경'})).created).toBe(false);
  expect(await ctx.db.get('SELECT password_hash FROM auth_credentials WHERE email=?','teacher@example.test')).toEqual(before);
 });
 it('초대 1회 사용을 원자적으로 처리하고 가입자의 권한 변경·잘못된 초대·약한 비밀번호를 거부한다',async()=> {
  const ctx=await setup(),code=await invite(ctx),body={email:'new@example.test',password,name:'학생',invite_code:code};
  await request(ctx.service.app).post('/api/auth/register').send({...body,role:'professor'}).expect(422);
  await request(ctx.service.app).post('/api/auth/register').send({...body,password:'weak'}).expect(422);
  await request(ctx.service.app).post('/api/auth/register').send({...body,invite_code:'a'.repeat(43)}).expect(422);
  expect((await ctx.db.get<{n:number}>('SELECT COUNT(*) AS n FROM users'))!.n).toBe(1);
  const outcomes=await Promise.all([request(ctx.service.app).post('/api/auth/register').send(body),request(ctx.service.app).post('/api/auth/register').send({...body,email:'other@example.test'})]);
  expect(outcomes.map(r=>r.status).sort()).toEqual([201,422]);expect((await ctx.db.get<{n:number}>('SELECT COUNT(*) AS n FROM users'))!.n).toBe(2);
  const expired=await invite(ctx);await ctx.db.run('UPDATE course_invites SET expires_at=? WHERE token_hash=?',Date.now()-1,tokenHash(expired));
  await request(ctx.service.app).post('/api/auth/register').send({...body,email:'expired@example.test',invite_code:expired}).expect(422);
  const {agent}=await student(ctx,'두 번째 학생');await agent.post(`/api/courses/${ctx.course}/invites`).send({role:'professor'}).expect(403);await agent.post('/api/courses').send({title:'임의 강의'}).expect(403);
 });
 it('실제 PDF 추출·초안 수정·게시·학생 제출·개인 오답·교수 PDF를 MySQL에서 연결한다',async()=> {
  const ctx=await setup(),a=await student(ctx),b=await student(ctx,'학생 나'),base=`/api/courses/${ctx.course}/weeks/${ctx.week}`;
  const material=(await ctx.professor.post(base+'/materials').field('source_type','document').field('slide_start','2').field('slide_end','3').field('original_visible_to_students','false').attach('file',resolve(root,'tests/fixtures/generated/sample.pdf')).expect(202)).body;
  await ctx.service.waitForJobs();
  const generated=await Promise.all([0,1].map(()=>ctx.professor.post(base+'/quiz-drafts').set('Idempotency-Key','same-generation').send({material_ids:[material.material_id],question_count:5}).expect(202)));
  expect(generated[0].body.job_id).toBe(generated[1].body.job_id);await ctx.service.waitForJobs();
  const job=(await ctx.professor.get('/api/jobs/'+generated[0].body.job_id).expect(200)).body;expect(job.status).toBe('completed');
  let draft:QuizDraft=(await ctx.professor.get('/api/quiz-drafts/'+job.result.draft_id).expect(200)).body;
  const question=draft.questions[0];draft=(await ctx.professor.patch(`/api/quiz-drafts/${draft.draft_id}/questions/${question.question_id}`).set('Idempotency-Key','edit').send({expected_version:draft.version,prompt:'수정한 정규화 문제',options:question.options,correct_option_id:question.correct_option_id,explanation:'수정한 풀이: 중복을 줄입니다.'}).expect(200)).body;
  const quiz=(await ctx.professor.post(`/api/quiz-drafts/${draft.draft_id}/publish`).set('Idempotency-Key','publish').send({expected_version:draft.version,question_ids:draft.questions.map(q=>q.question_id)}).expect(201)).body;
  const publicQuiz:PublicQuiz=(await a.agent.get('/api/quizzes/'+quiz.quiz_id).expect(200)).body;
  expect(JSON.stringify(publicQuiz)).not.toMatch(/correct_option_id|explanation|sources/);await a.agent.get(`/api/materials/${material.material_id}/original`).expect(403);
  const answers={answers:publicQuiz.questions.map((q,i)=>({question_id:q.question_id,option_id:i<3?'a':'b'}))};
  const submitted=await Promise.all([0,1].map(()=>a.agent.post(`/api/quizzes/${quiz.quiz_id}/attempts`).set('Idempotency-Key','same-attempt').send(answers).expect(201)));
  expect(submitted[0].body.attempt_id).toBe(submitted[1].body.attempt_id);expect(submitted[0].body.wrong_questions).toHaveLength(2);
  expect((await b.agent.get('/api/me/attempts').expect(200)).body).toEqual([]);
  const own=(await a.agent.get(`/api/courses/${ctx.course}/reports/wrong-answers`).expect(200)).body;expect(own.summary.wrong_count).toBe(2);
  expect((await b.agent.get(`/api/courses/${ctx.course}/reports/wrong-answers`).expect(200)).body.summary.submission_count).toBe(0);
  const report=(await ctx.professor.get(`/api/courses/${ctx.course}/reports/quizzes`).expect(200)).body;expect(report.summary.participation_rate).toBe(.5);expect(report.summary.correct_rate).toBe(.6);
  for(const [actor,path] of [[ctx.professor,`/api/courses/${ctx.course}/reports/pdf`],[a.agent,`/api/courses/${ctx.course}/reports/wrong-answers/pdf`]] as const)expect((await actor.get(path).expect(200)).headers['content-type']).toContain('application/pdf');
  await a.agent.get(`/api/courses/${ctx.course}/reports/quizzes`).expect(403);
  await ctx.service.close();resources.splice(0,1);
  const database=new MySQLDatabase(url!),restarted=createApp({root,dataDir:ctx.dir,demoAuth:false,database,...dependencies});resources.push({close:()=>restarted.close(),dir:ctx.dir});await restarted.initialized;
  const saved=await request(restarted.app).get('/api/me/attempts').set('Cookie',a.cookie).expect(200);expect(saved.body[0].attempt_id).toBe(submitted[0].body.attempt_id);expect(saved.body[0].wrong_questions).toHaveLength(2);
  const professorCookie=(ctx.cookie as unknown as string[])[0].split(';')[0];const restored=(await request(restarted.app).get(base+'/content').set('Cookie',professorCookie).expect(200)).body;expect(restored.drafts[0].questions[0].prompt).toBe('수정한 정규화 문제');
  await request(restarted.app).get(`/api/materials/${material.material_id}/original`).set('Cookie',professorCookie).expect(200);
 },30000);
 it('YouTube 근거와 Jev 판단·추가 질문 1회·교수 답변을 MySQL에 보존한다',async()=> {
  const ctx=await setup(),a=await student(ctx),b=await student(ctx,'학생 나'),base=`/api/courses/${ctx.course}/weeks/${ctx.week}`;
  await ctx.professor.post(base+'/youtube').send({url:'https://www.youtube.com/watch?v=XwsPTAnFRsk',original_visible_to_students:false}).expect(202);await ctx.service.waitForJobs();
  const created=(await a.agent.post(base+'/threads').set('Idempotency-Key','qa').send({text:'모호한 정규화 질문'}).expect(201)).body;await ctx.service.waitForJobs();
  let thread=(await a.agent.get('/api/threads/'+created.thread_id).expect(200)).body;expect(thread.clarification_count).toBe(1);expect(thread.state).toBe('awaiting_student');
  await b.agent.get('/api/threads/'+thread.thread_id).expect(403);
  await a.agent.post(`/api/threads/${thread.thread_id}/messages`).set('Idempotency-Key','followup').send({text:'아직 모호합니다.',expected_version:thread.version}).expect(202);await ctx.service.waitForJobs();
  thread=(await a.agent.get('/api/threads/'+thread.thread_id).expect(200)).body;expect(thread.state).toBe('awaiting_professor');expect(thread.clarification_count).toBe(1);
  await a.agent.post(`/api/threads/${thread.thread_id}/messages`).set('Idempotency-Key','extra').send({text:'두 번째 보완',expected_version:thread.version}).expect(422);
  await ctx.professor.post(`/api/threads/${thread.thread_id}/messages`).set('Idempotency-Key','teacher-answer').send({text:'교수 답변입니다.',expected_version:thread.version}).expect(200);
  expect((await a.agent.get('/api/threads/'+thread.thread_id).expect(200)).body.messages.at(-1).text).toBe('교수 답변입니다.');
  expect((await ctx.professor.get(`/api/courses/${ctx.course}/reports/qa`).expect(200)).body.summary.clarified_thread_count).toBe(1);
 });
 it('서로 다른 강의와 주차를 격리하고 트랜잭션 실패 시 기록과 후속 작업을 취소한다',async()=> {
  const ctx=await setup(),a=await student(ctx),other=(await ctx.professor.post('/api/courses').send({title:'별도 강의',week_count:2}).expect(201)).body;
  await a.agent.get(`/api/courses/${other.course_id}/weeks`).expect(403);await a.agent.get(`/api/courses/${other.course_id}/reports/wrong-answers`).expect(403);
  const code=(await ctx.professor.post(`/api/courses/${other.course_id}/invites`).send({role:'student'}).expect(201)).body.invite_code;
  await a.agent.post('/api/courses/join').send({invite_code:code}).expect(201);await a.agent.get(`/api/courses/${other.course_id}/reports/wrong-answers?week_ids=${ctx.week}`).expect(404);
  let ran=false;const id=randomUUID();await expect(ctx.db.transaction(async()=>{await ctx.db.run('INSERT INTO courses VALUES (?,?)',id,'취소할 강의');ctx.db.afterCommit(()=>{ran=true});throw Error('rollback')})).rejects.toThrow('rollback');expect(ran).toBe(false);expect(await ctx.db.get('SELECT id FROM courses WHERE id=?',id)).toBeUndefined();
  await ctx.db.transaction(async()=>ctx.db.afterCommit(()=>{ran=true}));expect(ran).toBe(true);
 });
 it('새 풀과 앱 프로세스에서도 세션·계정·강의를 유지하고 중복 실행을 막는다',async()=> {
  const ctx=await setup();await ctx.db.acquireRuntimeLock();const second=new MySQLDatabase(url!);await expect(second.acquireRuntimeLock()).rejects.toThrow('one replica');await second.close();
  const cookie=(ctx.cookie as unknown as string[])[0].split(';')[0];await ctx.service.close();resources.splice(0,1);
  const db=new MySQLDatabase(url!);await db.migrate(root);await db.acquireRuntimeLock();const service=createApp({root,dataDir:ctx.dir,demoAuth:false,database:db,...dependencies});resources.push({close:()=>service.close(),dir:ctx.dir});
  expect((await request(service.app).get('/api/me').set('Cookie',cookie).expect(200)).body.name).toBe('실제 계정 교수');expect((await request(service.app).get('/api/courses').set('Cookie',cookie).expect(200)).body[0].course_id).toBe(ctx.course);
 });
 it('실제 배포 모드는 HTTPS 세션 쿠키를 발급하고 다른 사이트의 변경 요청을 거부한다',async()=> {
  const ctx=await setup(),service=createApp({root,dataDir:ctx.dir,demoAuth:false,database:ctx.db,production:true,publicOrigin:'https://campus.example.test',...dependencies});await service.initialized;
  const response=await request(service.app).post('/api/auth/login').set('Origin','https://campus.example.test').send({email:'teacher@example.test',password}).expect(200);
  expect(response.headers['set-cookie'][0]).toMatch(/^__Host-campus_session=.*HttpOnly; Secure; SameSite=Strict/);
  await request(service.app).post('/api/auth/login').set('Origin','https://attacker.example').send({email:'teacher@example.test',password}).expect(403);
  await request(service.app).post('/api/dev/login').set('Origin','https://campus.example.test').send({}).expect(404);
  expect(()=>createApp({root,dataDir:ctx.dir,demoAuth:true,production:true,database:ctx.db,publicOrigin:'https://campus.example.test'})).toThrow('Production requires');
 });
});
