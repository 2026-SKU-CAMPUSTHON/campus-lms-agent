import {afterEach,describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import type {IncomingMessage} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {IDS} from '../src/store.js';
import type {AttemptResult,DraftQuestion,PublicQuiz} from '../src/types.js';
import type {StudentWrongReport} from '../src/reports/types.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),base=`/api/courses/${IDS.course}/reports/wrong-answers`,resources:{service:ReturnType<typeof createApp>;dir:string}[]=[];
afterEach(async()=>{vi.unstubAllEnvs();for(const r of resources.splice(0)){await r.service.close();rmSync(r.dir,{recursive:true,force:true})}});
function setup(dir=mkdtempSync(resolve(tmpdir(),'campus-student-report-'))){const judge=vi.fn(async()=>{throw new Error('No model in student reports')}),service=createApp({root,dataDir:dir,demoAuth:true,qaJudge:judge});resources.push({service,dir});return {...service,judge}}
type App=ReturnType<typeof setup>;
async function login(app:App,user=IDS.student){const agent=request.agent(app.app);await agent.post('/api/dev/login').send({user_id:user}).expect(200);return agent}
function seed(app:App,week=IDS.week,prefix='검증',count=2,course=IDS.course){const draft=randomUUID(),quiz=randomUUID(),questions:DraftQuestion[]=Array.from({length:count},(_,i)=>({question_id:randomUUID(),prompt:`${prefix} 문제 ${i+1}`,options:['정답','오답','세 번째','네 번째'].map((text,i)=>({option_id:String.fromCharCode(97+i),text})),correct_option_id:'a',explanation:`${prefix} 풀이 ${i+1}: sin(nπx/L)를 확인합니다.`,sources:[{material_id:randomUUID(),chunk_id:randomUUID(),source_type:'transcript',slide_no:null,start_sec:732,end_sec:780,origin:'youtube',material_name:'검증 강의',media_type:'video',original_visible_to_students:false}]}));app.store.run('INSERT INTO drafts VALUES (?,?,?,?)',draft,course,week,JSON.stringify({draft_id:draft,week_id:week,version:2,questions}));app.store.run('INSERT INTO quizzes VALUES (?,?,?,?,?)',quiz,draft,course,week,JSON.stringify({quiz_id:quiz,week_id:week,questions}));return {quiz_id:quiz,questions}}
async function submit(agent:Awaited<ReturnType<typeof login>>,q:ReturnType<typeof seed>,answers:string[]){return (await agent.post(`/api/quizzes/${q.quiz_id}/attempts`).set('Idempotency-Key',randomUUID()).send({answers:q.questions.map((question,i)=>({question_id:question.question_id,option_id:answers[i]}))}).expect(201)).body as AttemptResult}
function bytes(res:IncomingMessage,done:(error:Error|null,body?:Buffer)=>void){const chunks:Buffer[]=[];res.on('data',c=>chunks.push(Buffer.from(c)));res.on('end',()=>done(null,Buffer.concat(chunks)));res.on('error',done)}
function text(pdf:Buffer){return execFileSync(process.env.PYTHON_BIN||'python3',['-c','import sys,io;from pypdf import PdfReader;print("\\n".join(p.extract_text() for p in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages))'],{input:pdf,maxBuffer:4*1024*1024}).toString()}
describe('학생 개인 주차별 오답 레포트',()=>{
 it('본인 제출만 집계하고 오답의 내 선택/정답/풀이/출처와 원래 문항 번호를 보존한다',async()=>{
  const app=setup(),a=await login(app),b=await login(app,IDS.student2),q=seed(app),q2=seed(app,IDS.week2,'다음 주차');seed(app,IDS.week,'미응시 비밀');const saved=await submit(a,q,['b','a']);await submit(b,q,['a','b']);await submit(a,q2,['a','b']);
  const all=(await a.get(base).expect(200)).body as StudentWrongReport;expect(all.summary).toEqual({submission_count:2,total_count:4,correct_count:2,wrong_count:2,correct_rate:.5});expect(all.weeks[0].attempts[0].wrong_questions[0]).toEqual({...saved.wrong_questions[0],question_no:1});expect(all.weeks[1].attempts[0].wrong_questions[0].question_no).toBe(2);expect(JSON.stringify(all)).not.toMatch(/미응시 비밀|검증 문제 2|student_id|youtube\.com|XwsPTAnFRsk/);
  const ownB=(await b.get(base+'?week_ids='+IDS.week).expect(200)).body as StudentWrongReport;expect(ownB.weeks[0].attempts[0].wrong_questions[0].question_no).toBe(2);expect(ownB.summary.wrong_count).toBe(1);expect(app.judge).not.toHaveBeenCalled();
 });
 it('학생 선택 주차 PDF에 본인 오답만 담고 학생/미응시/다른 주차 내용을 제외한다',async()=>{
  const app=setup(),a=await login(app),b=await login(app,IDS.student2),q=seed(app);await submit(a,q,['b','a']);await submit(b,q,['a','b']);seed(app,IDS.week,'미제출 정답');const next=seed(app,IDS.week2,'다른주차');await submit(a,next,['b','b']);
  const pdf=await a.get(base+'/pdf?week_ids='+IDS.week).buffer(true).parse(bytes).expect(200);expect(pdf.headers['content-type']).toContain('application/pdf');expect(pdf.headers['content-disposition']).toMatch(/attachment; filename="campus-wrong-answers-\d{4}-\d{2}-\d{2}\.pdf"/);expect(pdf.headers['cache-control']).toBe('no-store');const contents=text(pdf.body);for(const marker of ['나의 오답 레포트','검증 문제 1','내 선택 B · 정답 A','검증 풀이 1','sin(nπx/L)','12:12 - 13:00','원본 비공개'])expect(contents).toContain(marker);expect(contents).not.toMatch(/검증 문제 2|검증 풀이 2|미제출 정답|다른주차|학생 나|Q&A|교수용|youtube\.com/);expect(app.judge).not.toHaveBeenCalled();
 },20000);
 it('비로그인/교수/비수강생·다른 강의 주차·사용자/제출 ID 위조 필터를 차단한다',async()=>{
  const app=setup(),student=await login(app),professor=await login(app,IDS.professor),outsider=await login(app,IDS.outsider),other=randomUUID();app.store.run('INSERT INTO weeks VALUES (?,?,?,?)',other,IDS.otherCourse,1,'다른 강의');
  for(const suffix of ['', '/pdf']){await request(app.app).get(base+suffix).expect(401);await professor.get(base+suffix).expect(403);await outsider.get(base+suffix).expect(403);await student.get(`/api/courses/${IDS.otherCourse}/reports/wrong-answers${suffix}`).expect(403);await student.get(base+suffix+'?week_ids='+other).expect(404);for(const query of ['?week_ids=','?week_ids=bad','?user_id='+IDS.student2,'?attempt_id='+randomUUID(),'?quiz_id='+randomUUID()])await student.get(base+suffix+query).expect(422)}
 });
 it('다른 강의에도 수강 중인 학생의 제출을 현재 강의에 섞지 않는다',async()=>{
  const app=setup(),student=await login(app),otherWeek=randomUUID();app.store.run('INSERT INTO memberships VALUES (?,?,?)',IDS.student,IDS.otherCourse,'student');app.store.run('INSERT INTO weeks VALUES (?,?,?,?)',otherWeek,IDS.otherCourse,1,'별개');const q=seed(app,otherWeek,'다른강의 비밀',2,IDS.otherCourse);await submit(student,q,['b','b']);expect((await student.get(base).expect(200)).body.summary.submission_count).toBe(0);expect(text((await student.get(base+'/pdf').buffer(true).parse(bytes).expect(200)).body)).not.toContain('다른강의 비밀');
 },20000);
 it('미응시와 모두 정답을 구분하고 전체/중복 주차 선택을 처리한다',async()=>{
  const app=setup(),student=await login(app),q=seed(app);await submit(student,q,['a','a']);const none=(await student.get(base+'?week_ids='+IDS.week2+','+IDS.week2)).body;expect(none.weeks).toHaveLength(1);expect(none.summary).toMatchObject({submission_count:0,wrong_count:0,correct_rate:null});const perfect=(await student.get(base+'?week_ids='+IDS.week)).body;expect(perfect.summary).toMatchObject({submission_count:1,wrong_count:0,correct_rate:1});expect(perfect.weeks[0].attempts[0].wrong_questions).toEqual([]);const emptyPDF=text((await student.get(base+'/pdf?week_ids='+IDS.week2).buffer(true).parse(bytes).expect(200)).body);expect(emptyPDF).toContain('아직 제출한 퀴즈가 없습니다.');expect(emptyPDF).not.toContain('모두 맞혔습니다');const perfectPDF=text((await student.get(base+'/pdf?week_ids='+IDS.week).buffer(true).parse(bytes).expect(200)).body);expect(perfectPDF).toContain('모두 맞혔습니다. 오답이 없습니다.');expect(perfectPDF).not.toContain('검증 문제');
 },20000);
 it('저장된 제출 스냅샷을 쓰며 재시작 후에도 오답/정답/풀이를 유지한다',async()=>{
  const app=setup(),student=await login(app),q=seed(app),saved=await submit(student,q,['a','b']),row=app.store.get<{data:string}>('SELECT data FROM quizzes WHERE id=?',q.quiz_id)!,quiz=JSON.parse(row.data) as PublicQuiz;quiz.questions[1].prompt='현재 자료의 다른 표현';app.store.run('UPDATE quizzes SET data=? WHERE id=?',JSON.stringify(quiz),q.quiz_id);
  const before=(await student.get(base).expect(200)).body.weeks[0].attempts[0].wrong_questions[0];expect(before).toEqual({...saved.wrong_questions[0],question_no:2});const resource=resources.find(r=>r.service.store===app.store)!;await resource.service.close();resources.splice(resources.indexOf(resource),1);const restarted=setup(resource.dir),returning=await login(restarted);expect((await returning.get(base).expect(200)).body.weeks[0].attempts[0].wrong_questions[0]).toEqual(before);
 });
 it('초과한 본인 제출/오답은 잘라내지 않고 오류를 반환한다',async()=>{
  for(const [quizCount,questionCount,allWrong] of [[1001,1,false],[41,50,true]] as const){const app=setup(),student=await login(app);for(let i=0;i<quizCount;i++){const q=seed(app,IDS.week,'한도',questionCount),id=randomUUID();app.store.run('INSERT INTO attempts VALUES (?,?,?,?)',id,IDS.student,q.quiz_id,JSON.stringify({attempt_id:id,quiz_id:q.quiz_id,total_count:questionCount,correct_count:allWrong?0:questionCount,wrong_questions:allWrong?q.questions.map(q=>({...q,selected_option_id:'b'})):[]}))}for(const suffix of ['','/pdf'])expect((await student.get(base+suffix).expect(422)).body.code).toBe('REPORT_TOO_LARGE')}
 },20000);
});
