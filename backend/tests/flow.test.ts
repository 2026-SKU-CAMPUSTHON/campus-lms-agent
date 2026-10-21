import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { IDS } from '../src/store.js';
import { generateAcrossRange, validateQuestions, type Generator } from '../src/quiz-generation/questions.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const prefix=`/api/courses/${IDS.course}/weeks/${IDS.week}`;
const resources:{service:ReturnType<typeof createApp>;dir:string}[]=[];
beforeAll(()=>execFileSync('python3',[resolve(root,'scripts/create-sample-pdf.py')]));
afterEach(async()=>{for(const {service,dir} of resources.splice(0)){await service.close();rmSync(dir,{recursive:true,force:true})}});
function setup(generator?:Generator) {
  const dir=mkdtempSync(resolve(tmpdir(),'campus-flow-'));
  const service=createApp({root,dataDir:dir,demoAuth:true,generator});resources.push({service,dir});return service;
}
const fake:Generator=async(slides,count,previous=[])=>Array.from({length:count},(_,i)=>({prompt:`데이터베이스 개념 확인 문제 ${previous.length+i+1}입니다.`,options:['중복 감소','중복 증가','기록 삭제','무작위 선택'],correct_index:0,explanation:'정규화는 자료의 중복을 줄이기 위한 방법입니다.',slide_nos:[slides[0].slide_no]}));
async function login(service:ReturnType<typeof setup>,user=IDS.professor) {const agent=request.agent(service.app);await agent.post('/api/dev/login').send({user_id:user}).expect(200);return agent}
async function material(service:ReturnType<typeof setup>,professor:Awaited<ReturnType<typeof login>>,end='3') {
  const upload=await professor.post(prefix+'/materials').field('source_type','document').field('slide_start','2').field('slide_end',end).field('original_visible_to_students','false').attach('file',resolve(root,'tests/fixtures/generated/sample.pdf')).expect(202);
  await service.waitForJobs();return upload.body;
}
async function publish(service:ReturnType<typeof setup>,professor:Awaited<ReturnType<typeof login>>) {
  const m=await material(service,professor);
  const receipt=await professor.post(prefix+'/quiz-drafts').set('Idempotency-Key','generate').send({material_ids:[m.material_id],question_count:3}).expect(202);
  await service.waitForJobs();const job=await professor.get('/api/jobs/'+receipt.body.job_id).expect(200);
  expect(job.body.status).toBe('completed');
  const draft=(await professor.get('/api/quiz-drafts/'+job.body.result.draft_id).expect(200)).body;
  const posted=await professor.post(`/api/quiz-drafts/${draft.draft_id}/publish`).set('Idempotency-Key','publish').send({question_ids:draft.questions.slice(0,2).map((q:{question_id:string})=>q.question_id)}).expect(201);
  return {m,draft,quiz_id:posted.body.quiz_id};
}
describe('실제 문서 처리와 퀴즈 전체 흐름 (AI는 주입한 테스트 대역)',()=> {
  it('범위를 추출하고 일부만 게시하며 제출 전 정답을 숨기고 개인 오답을 보존한다',async()=> {
    const generator=vi.fn(fake);const service=setup(generator);const professor=await login(service);const student=await login(service,IDS.student);
    const {m,draft,quiz_id}=await publish(service,professor);
    const sentSlides=generator.mock.calls[0][0];expect(sentSlides.map(s=>s.slide_no)).toEqual([2,3]);expect(sentSlides[0].text).toContain('Normalization');
    await student.get(`/api/materials/${m.material_id}/original`).expect(403);
    await student.get(`/api/quiz-drafts/${draft.draft_id}`).expect(403);
    const publicQuiz=await student.get('/api/quizzes/'+quiz_id).expect(200);
    expect(publicQuiz.body.questions).toHaveLength(2);expect(JSON.stringify(publicQuiz.body)).not.toMatch(/correct_option_id|explanation|sources/);
    const body={answers:publicQuiz.body.questions.map((q:{question_id:string})=>({question_id:q.question_id,option_id:'b'}))};
    const result=await student.post(`/api/quizzes/${quiz_id}/attempts`).set('Idempotency-Key','submit').send(body).expect(201);
    expect(result.body.correct_count).toBe(0);expect(result.body.wrong_questions).toHaveLength(2);expect(result.body.wrong_questions[0].explanation).toContain('중복');
    const retry=await student.post(`/api/quizzes/${quiz_id}/attempts`).set('Idempotency-Key','submit').send(body).expect(201);expect(retry.body.attempt_id).toBe(result.body.attempt_id);
    await student.post(`/api/quizzes/${quiz_id}/attempts`).set('Idempotency-Key','different').send(body).expect(409);
    expect((await student.get('/api/me/attempts')).body).toHaveLength(1);
    const student2=await login(service,IDS.student2);expect((await student2.get('/api/me/attempts')).body).toHaveLength(0);
    expect((await student.get(prefix+'/content')).body.drafts).toEqual([]);
    const index=resources.findIndex(r=>r.service===service);const dir=resources[index].dir;
    await service.close();resources.splice(index,1);
    const restarted=createApp({root,dataDir:dir,demoAuth:true,generator:fake});resources.push({service:restarted,dir});
    const returningStudent=await login(restarted,IDS.student);
    expect((await returningStudent.get('/api/me/attempts')).body[0].attempt_id).toBe(result.body.attempt_id);
  });
  it('권한·다른 강의·원본 공개 설정을 서버에서 검사한다',async()=> {
    const service=setup(fake),professor=await login(service),student=await login(service,IDS.student),outsider=await login(service,IDS.outsider);
    const {m,quiz_id}=await publish(service,professor);
    await outsider.get('/api/quizzes/'+quiz_id).expect(403);await outsider.get(`/api/materials/${m.material_id}/original`).expect(403);
    await student.post(prefix+'/quiz-drafts').set('Idempotency-Key','forbidden').send({material_ids:[m.material_id],question_count:3}).expect(403);
    await professor.post(`/api/quizzes/${quiz_id}/attempts`).set('Idempotency-Key','forbidden').send({answers:[]}).expect(403);
    await professor.post(`/api/courses/${IDS.otherCourse}/weeks/${IDS.week}/materials`).expect(403);
    await student.post('/api/logout').send({}).expect(204);await student.get('/api/me').expect(401);
    await request(service.app).post('/api/dev/login').set('Origin','https://untrusted.example').send({user_id:IDS.professor}).expect(403);
  });
  it('범위 초과·키 누락·잘못된 AI 응답은 성공으로 처리하지 않는다',async()=> {
    const service=setup(),professor=await login(service);
    const invalid=await material(service,professor,'99');const failed=(await professor.get('/api/jobs/'+invalid.job_id)).body;
    expect(failed.status).toBe('failed');expect(failed.error.code).toBe('DOCUMENT_EXTRACTION_FAILED');
    const valid=await material(service,professor);
    await professor.post(prefix+'/quiz-drafts').set('Idempotency-Key','no-key').send({material_ids:[valid.material_id],question_count:3}).expect(503);
    expect((await professor.get(prefix+'/content')).body.drafts).toHaveLength(0);
    expect(()=>validateQuestions({questions:[{prompt:'범위를 벗어난 문제입니다.',options:['a','b','c','d'],correct_index:0,explanation:'충분한 길이의 설명입니다.',slide_nos:[99]}]},[{slide_no:2,text:'text'}],1)).toThrow();
  });
  it('모델 실패 시 실패 작업으로 기록하고 초안을 만들지 않는다',async()=> {
    const service=setup(async()=>{throw new Error('provider unavailable')});const professor=await login(service);const m=await material(service,professor);
    const receipt=await professor.post(prefix+'/quiz-drafts').set('Idempotency-Key','provider-failure').send({material_ids:[m.material_id],question_count:3}).expect(202);
    await service.waitForJobs();const job=(await professor.get('/api/jobs/'+receipt.body.job_id)).body;
    expect(job.status).toBe('failed');expect(job.error.retryable).toBe(true);expect((await professor.get(prefix+'/content')).body.drafts).toHaveLength(0);
  });
  it('50문항을 여러 배치로 생성하되 전체 자료를 보내고 범위 밖 출처를 거부한다',async()=> {
    const spy=vi.fn(fake);const slides=[{slide_no:3,text:'첫 개념'},{slide_no:4,text:'둘째 개념'}];
    const result=await generateAcrossRange(slides,50,spy);expect(result).toHaveLength(50);expect(spy).toHaveBeenCalledTimes(7);expect(spy.mock.calls[0][0]).toEqual(slides);
    await expect(generateAcrossRange(slides,2,async()=>{throw new Error('provider offline')})).rejects.toThrow('provider offline');
  });
});
