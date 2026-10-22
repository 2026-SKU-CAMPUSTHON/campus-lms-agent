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
import type {DraftQuestion} from '../src/types.js';
import type {StoredThread} from '../src/qa/types.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),prefix=`/api/courses/${IDS.course}/reports/pdf`,resources:{app:ReturnType<typeof createApp>;dir:string}[]=[];
afterEach(async()=>{vi.unstubAllEnvs();for(const item of resources.splice(0)){await item.app.close();rmSync(item.dir,{recursive:true,force:true})}});
function setup(){const dir=mkdtempSync(resolve(tmpdir(),'campus-report-pdf-')),judge=vi.fn(async()=>{throw new Error('PDF must not call AI')}),app=createApp({root,dataDir:dir,demoAuth:true,qaJudge:judge});resources.push({app,dir});return {...app,judge}}
type App=ReturnType<typeof setup>;
async function login(app:App,user=IDS.professor){const agent=request.agent(app.app);await agent.post('/api/dev/login').send({user_id:user}).expect(200);return agent}
function bytes(res:IncomingMessage,done:(error:Error|null,body?:Buffer)=>void){const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));res.on('end',()=>done(null,Buffer.concat(chunks)));res.on('error',done)}
function extract(pdf:Buffer):{pages:number;text:string}{return JSON.parse(execFileSync(process.env.PYTHON_BIN||'python3',['-c','import sys,io,json;from pypdf import PdfReader;r=PdfReader(io.BytesIO(sys.stdin.buffer.read()));print(json.dumps({"pages":len(r.pages),"text":"\\n".join(p.extract_text() for p in r.pages)},ensure_ascii=False))'],{input:pdf,maxBuffer:4*1024*1024}).toString())}
function seedQuiz(app:App,week=IDS.week,prompt='한국어 PDF 검증 문항'){
 const draft=randomUUID(),id=randomUUID(),question:DraftQuestion={question_id:randomUUID(),prompt,options:['정답 보기','오답 보기','다른 보기','마지막 보기'].map((text,i)=>({option_id:String.fromCharCode(97+i),text})),correct_option_id:'a',explanation:'PDF에도 수정된 풀이를 보존합니다.',sources:[{material_id:randomUUID(),chunk_id:randomUUID(),source_type:'transcript',slide_no:null,start_sec:732,end_sec:780,origin:'youtube',material_name:'한국어 합성 강의',media_type:'video',original_visible_to_students:false}]};
 app.store.run('INSERT INTO drafts VALUES (?,?,?,?)',draft,IDS.course,week,JSON.stringify({draft_id:draft,week_id:week,version:2,questions:[question]}));app.store.run('INSERT INTO quizzes VALUES (?,?,?,?,?)',id,draft,IDS.course,week,JSON.stringify({quiz_id:id,week_id:week,questions:[question]}));return {id,question};
}
function seedThread(app:App,index:number,week=IDS.week){
 const now=new Date().toISOString(),value:StoredThread={thread_id:randomUUID(),course_id:IDS.course,week_id:week,student_id:IDS.student,student_name:'학생 가',state:'resolved',clarification_count:1,processing_status:'idle',version:5,created_at:now,updated_at:now,error:null,handoff_reason:'unclear_after_clarification',attempt_count:2,decisions:[{at:now,attempt:1,decision:{model:'internal-secret-model',clarity:{label:'unclear',confidence:1,probabilities:{clear:0,unclear:1}},evidence:{label:'insufficient',confidence:1,probabilities:{sufficient:0,insufficient:1}}},route:'clarify',source_ids:[]}],messages:[{message_id:randomUUID(),author_role:'student',kind:'question',text:`대화 식별자 ${index}번 전체 질문`,sources:[],created_at:now},{message_id:randomUUID(),author_role:'professor',kind:'answer',text:`교수 답변 식별자 ${index}번 확인`,sources:[],created_at:now}]};app.store.run('INSERT INTO threads VALUES (?,?,?,?,?)',value.thread_id,IDS.course,week,IDS.student,JSON.stringify(value));return value;
}
describe('교수 PDF 다운로드',()=>{
 it('한글 PDF에 선택 주차 집계·문항·시간 출처·100개 밖 Q&A까지 모두 담고 AI를 호출하지 않는다',async()=>{
  const app=setup(),prof=await login(app),student=await login(app,IDS.student),q=seedQuiz(app);seedQuiz(app,IDS.week2,'제외할 다른 주차 문제');for(let i=0;i<106;i++)seedThread(app,i);seedThread(app,999,IDS.week2);
  await student.post(`/api/quizzes/${q.id}/attempts`).set('Idempotency-Key',randomUUID()).send({answers:[{question_id:q.question.question_id,option_id:'a'}]}).expect(201);
  const response=await prof.get(prefix+'?week_ids='+IDS.week).buffer(true).parse(bytes).expect(200);expect(response.headers['content-type']).toContain('application/pdf');expect(response.headers['content-disposition']).toMatch(/attachment; filename="campus-report-\d{4}-\d{2}-\d{2}\.pdf"; filename\*=UTF-8''/);expect(response.headers['cache-control']).toBe('no-store');expect(response.body.subarray(0,5).toString()).toBe('%PDF-');const output=extract(response.body);expect(output.pages).toBeGreaterThan(3);expect(output.text).toContain('50%');expect(output.text).toContain('100%');expect(output.text).toContain('한국어 PDF 검증 문항');expect(output.text).toContain('PDF에도 수정된 풀이');expect(output.text).toContain('12:12 - 13:00');for(const i of [0,25,100,105]){expect(output.text).toContain(`대화 식별자 ${i}번 전체 질문`);expect(output.text).toContain(`교수 답변 식별자 ${i}번 확인`)}expect(output.text).not.toMatch(/제외할 다른 주차|식별자 999번|internal-secret-model|probabilities|student_id|10000000-0000/);expect(app.judge).not.toHaveBeenCalled();
 },20000);
 it('학생·다른 강의 교수·비로그인·다른 강의 주차와 잘못된 인수를 다운로드 전에 차단한다',async()=>{
  const app=setup(),prof=await login(app),student=await login(app,IDS.student),other=await login(app,IDS.outsider);await request(app.app).get(prefix).expect(401);await student.get(prefix).expect(403);await other.get(prefix).expect(403);app.store.run('UPDATE memberships SET role=? WHERE user_id=?','professor',IDS.outsider);await other.get(prefix).expect(403);await prof.get(`/api/courses/${IDS.otherCourse}/reports/pdf`).expect(403);const id=randomUUID();app.store.run('INSERT INTO weeks VALUES (?,?,?,?)',id,IDS.otherCourse,1,'다른 주차');await prof.get(prefix+'?week_ids='+id).expect(404);for(const query of ['?week_ids=','?week_ids=bad','?page=2','?week_ids='+IDS.week+','])await prof.get(prefix+query).expect(422);
 });
 it('빈 주차·전체 선택·중복 선택을 보존하고 집계 없음과 0%를 구분한다',async()=>{
  const app=setup(),prof=await login(app);seedQuiz(app);const all=extract((await prof.get(prefix).buffer(true).parse(bytes).expect(200)).body);expect(all.text).toContain('1주차, 2주차');expect(all.text).toContain('0%');expect(all.text).toContain('집계 없음');const empty=extract((await prof.get(prefix+'?week_ids='+IDS.week2+','+IDS.week2).buffer(true).parse(bytes).expect(200)).body);expect(empty.text).toContain('선택 주차 | 2주차');expect(empty.text).toContain('아직 게시한 퀴즈가 없습니다.');expect(empty.text).toContain('아직 질문이 없습니다.');expect(empty.text).not.toContain('한국어 PDF 검증 문항');
 },20000);
 it('의존성/실행 환경 오류를 JSON 오류로 반환하고 정상 PDF로 위장하지 않는다',async()=>{
  const app=setup(),prof=await login(app);vi.stubEnv('PYTHON_BIN',resolve(root,'package.json','no-python'));const response=await prof.get(prefix).expect(503);expect(response.headers['content-type']).toContain('application/json');expect(response.headers['content-disposition']).toBeUndefined();expect(response.body.code).toBe('REPORT_PDF_UNAVAILABLE');expect(JSON.stringify(response.body)).not.toContain('no-python');
 });
 it('크기 제한을 넘긴 보고서를 조용히 잘라내지 않고 주차 분할을 요청한다',async()=>{
  const app=setup(),prof=await login(app);for(let i=0;i<1001;i++)seedThread(app,i);const response=await prof.get(prefix).expect(422);expect(response.body.code).toBe('REPORT_TOO_LARGE');expect(response.body.message).toContain('주차');
 });
});
