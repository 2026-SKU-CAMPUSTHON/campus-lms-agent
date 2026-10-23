import {afterEach,describe,it,expect} from 'vitest';
import request from 'supertest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {IDS} from '../src/store.js';
import type {QuizDraft,Source} from '../src/types.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),base=`/api/courses/${IDS.course}/weeks/${IDS.week}`,resources:{app:ReturnType<typeof createApp>;dir:string}[]=[];
afterEach(async()=>{for(const r of resources.splice(0)){await r.app.close();rmSync(r.dir,{recursive:true,force:true})}});
function setup(dir=mkdtempSync(resolve(tmpdir(),'campus-draft-edit-'))){const app=createApp({root,dataDir:dir,demoAuth:true});resources.push({app,dir});return app}
async function login(app:ReturnType<typeof setup>,user=IDS.professor){const agent=request.agent(app.app);await agent.post('/api/dev/login').send({user_id:user}).expect(200);return agent}
function seed(app:ReturnType<typeof setup>,youtube=true,legacy=false):QuizDraft {
 const source:Source=youtube?{material_id:randomUUID(),chunk_id:randomUUID(),source_type:'transcript',slide_no:null,start_sec:732,end_sec:780,material_name:'합성 강의',media_type:'video',origin:'youtube',original_visible_to_students:false}:{material_id:randomUUID(),chunk_id:randomUUID(),source_type:'document',slide_no:2,start_sec:null,end_sec:null};
 const draft:QuizDraft={draft_id:randomUUID(),week_id:IDS.week,version:1,questions:Array.from({length:2},(_,i)=>({question_id:randomUUID(),prompt:`원래 문제 ${i+1}`,options:['원래 A','원래 B','원래 C','원래 D'].map((text,i)=>({option_id:String.fromCharCode(97+i),text})),correct_option_id:'a',explanation:'원래 풀이입니다.',sources:[source]}))};
 app.store.run('INSERT INTO drafts VALUES (?,?,?,?)',draft.draft_id,IDS.course,IDS.week,JSON.stringify(legacy?{...draft,version:undefined}:draft));return draft;
}
function edits(draft:QuizDraft){return {expected_version:draft.version,prompt:'교수님이 수정한 문제입니다.',options:[{option_id:'a',text:'수정한 A'},{option_id:'b',text:'수정한 B'},{option_id:'c',text:'수정한 C'},{option_id:'d',text:'수정한 D'}],correct_option_id:'b',explanation:'교수님이 확인한 새로운 풀이입니다.'}}
const path=(d:QuizDraft,id=d.questions[0].question_id)=>`/api/quiz-drafts/${d.draft_id}/questions/${id}`;
describe('교수 초안 수정·버전·게시된 수정본',()=> {
 it('문제/보기/정답/풀이를 저장하되 ID·출처·다른 문항을 유지한다',async()=> {
  for(const youtube of [true,false]){const app=setup(),prof=await login(app),draft=seed(app,youtube);const body=edits(draft);const changed=(await prof.patch(path(draft)).set('Idempotency-Key',randomUUID()).send(body).expect(200)).body;
   expect(changed.version).toBe(2);expect(changed.questions[0]).toMatchObject({prompt:body.prompt,options:body.options,correct_option_id:'b',explanation:body.explanation});expect(changed.questions[0].sources).toEqual(draft.questions[0].sources);expect(changed.questions[0].question_id).toBe(draft.questions[0].question_id);expect(changed.questions[1]).toEqual(draft.questions[1]);expect((await prof.get(base+'/content')).body.drafts[0]).toEqual(changed);
  }
 });
 it('수정한 문항만 게시해 새 정답으로 채점하고 오답/레포트에 수정본을 보존한다',async()=> {
  const app=setup(),prof=await login(app),student=await login(app,IDS.student),other=await login(app,IDS.student2),draft=seed(app),body=edits(draft);
  const saved=(await prof.patch(path(draft)).set('Idempotency-Key',randomUUID()).send(body)).body;
  const posted=(await prof.post(`/api/quiz-drafts/${draft.draft_id}/publish`).set('Idempotency-Key',randomUUID()).send({expected_version:saved.version,question_ids:[draft.questions[0].question_id]}).expect(201)).body;
  const quiz=(await student.get('/api/quizzes/'+posted.quiz_id)).body;expect(quiz.questions).toHaveLength(1);expect(quiz.questions[0].prompt).toBe(body.prompt);expect(quiz.questions[0].options).toEqual(body.options);expect(JSON.stringify(quiz)).not.toMatch(/correct_option_id|explanation|sources/);
  const result=(await student.post(`/api/quizzes/${posted.quiz_id}/attempts`).set('Idempotency-Key',randomUUID()).send({answers:[{question_id:draft.questions[0].question_id,option_id:'a'}]}).expect(201)).body;expect(result.correct_count).toBe(0);expect(result.wrong_questions[0]).toMatchObject({prompt:body.prompt,correct_option_id:'b',selected_option_id:'a',explanation:body.explanation,sources:draft.questions[0].sources});
  const correct=(await other.post(`/api/quizzes/${posted.quiz_id}/attempts`).set('Idempotency-Key',randomUUID()).send({answers:[{question_id:draft.questions[0].question_id,option_id:'b'}]}).expect(201)).body;expect(correct.correct_count).toBe(1);
  const report=(await prof.get(`/api/courses/${IDS.course}/reports/quizzes`)).body;expect(report.weeks[0].questions[0]).toMatchObject({prompt:body.prompt,correct_option_id:'b',explanation:body.explanation,correct_rate:.5});
  await prof.patch(path(draft)).set('Idempotency-Key',randomUUID()).send({...body,expected_version:2}).expect(409);expect((await student.get('/api/me/attempts')).body[0]).toEqual(result);
 });
 it('학생·다른 강의·비로그인 접근과 초안 밖 문항 수정을 차단한다',async()=> {
  const app=setup(),prof=await login(app),student=await login(app,IDS.student),outsider=await login(app,IDS.outsider),draft=seed(app),body=edits(draft);
  for(const agent of [student,outsider])await agent.patch(path(draft)).set('Idempotency-Key',randomUUID()).send(body).expect(403);
  await request(app.app).patch(path(draft)).set('Idempotency-Key',randomUUID()).send(body).expect(401);await prof.patch(path(draft,randomUUID())).set('Idempotency-Key',randomUUID()).send(body).expect(404);expect((await prof.get('/api/quiz-drafts/'+draft.draft_id)).body.version).toBe(1);
 });
 it('빈 값·중복 보기·잘못된 정답/보기 ID·출처/문항 ID 위조를 거부한다',async()=> {
  const app=setup(),prof=await login(app),draft=seed(app),body=edits(draft);
  for(const bad of [{...body,prompt:'  '},{...body,explanation:''},{...body,options:body.options.slice(0,3)},{...body,options:body.options.map(o=>({...o,text:'동일 보기'}))},{...body,correct_option_id:'z'},{...body,options:body.options.map(o=>({...o,option_id:'x'}))},{...body,sources:[]},{...body,question_id:randomUUID()},{...body,prompt:'a'.repeat(2001)}])await prof.patch(path(draft)).set('Idempotency-Key',randomUUID()).send(bad).expect(422);
  expect((await prof.get('/api/quiz-drafts/'+draft.draft_id)).body).toEqual(draft);
 });
 it('수정 요청 재전송은 버전을 중복 증가시키지 않고 다른 내용의 같은 키를 거부한다',async()=> {
  const app=setup(),prof=await login(app),draft=seed(app),body=edits(draft),key=randomUUID();const first=(await prof.patch(path(draft)).set('Idempotency-Key',key).send(body)).body;const retry=(await prof.patch(path(draft)).set('Idempotency-Key',key).send(body).expect(200)).body;expect(retry).toEqual(first);expect(first.version).toBe(2);await prof.patch(path(draft)).set('Idempotency-Key',key).send({...body,prompt:'다른 내용'}).expect(409);
 });
 it('오래된 화면의 저장·게시를 거부하며 최신 버전의 게시 재전송만 재사용한다',async()=> {
  const app=setup(),prof=await login(app),draft=seed(app),body=edits(draft);await prof.patch(path(draft)).set('Idempotency-Key',randomUUID()).send(body).expect(200);
  const conflict=await prof.patch(path(draft)).set('Idempotency-Key',randomUUID()).send({...body,prompt:'오래된 화면의 수정'}).expect(409);expect(conflict.body.code).toBe('DRAFT_VERSION_CONFLICT');
  const publish=`/api/quiz-drafts/${draft.draft_id}/publish`,ids=[draft.questions[0].question_id];await prof.post(publish).set('Idempotency-Key',randomUUID()).send({question_ids:ids,expected_version:1}).expect(409);await prof.post(publish).set('Idempotency-Key',randomUUID()).send({question_ids:ids}).expect(422);
  const key=randomUUID(),posted=(await prof.post(publish).set('Idempotency-Key',key).send({question_ids:ids,expected_version:2}).expect(201)).body;expect((await prof.post(publish).set('Idempotency-Key',key).send({question_ids:ids,expected_version:2}).expect(201)).body).toEqual(posted);
 });
 it('기존 버전 없는 초안을 1로 읽고 재시작 후 수정본·버전을 보존한다',async()=> {
  const app=setup(),prof=await login(app),draft=seed(app,true,true);expect((await prof.get('/api/quiz-drafts/'+draft.draft_id)).body.version).toBe(1);const saved=(await prof.patch(path(draft)).set('Idempotency-Key',randomUUID()).send(edits(draft)).expect(200)).body;
  const item=resources.find(r=>r.app===app)!;await app.close();resources.splice(resources.indexOf(item),1);const restarted=setup(item.dir),returning=await login(restarted);expect((await returning.get('/api/quiz-drafts/'+draft.draft_id)).body).toEqual(saved);
 });
});
