/** 명시한 실제 문서와 선택한 모델로 전체 흐름을 검증한다. 원문·키·생성 문항은 출력하지 않는다. */
import request from 'supertest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { createApp } from '../backend/src/app.js';
import {generationConfig} from '../backend/src/ai/config.js';
import { IDS } from '../backend/src/store.js';
const root=fileURLToPath(new URL('../',import.meta.url));config({path:resolve(root,'.env'),quiet:true});
const document=process.argv[2];if(!document)throw new Error('사용할 PDF/PPTX 경로를 인수로 주세요.');
const count=Number(process.argv[3] || 5),start=Number(process.argv[4] || 2),end=Number(process.argv[5] || 15);
const settings=generationConfig(),provider=settings.provider;
const service=createApp({root,dataDir:resolve(root,'.data'),demoAuth:true,...settings,jevApiKey:process.env.TYPESAFE_API_KEY,jevModel:process.env.JEV_MODEL});
const base=`/api/courses/${IDS.course}/weeks/${IDS.week}`;
const run=crypto.randomUUID();
try {
  const professor=request.agent(service.app);await professor.post('/api/dev/login').send({user_id:IDS.professor}).expect(200);
  const receipt=await professor.post(base+'/materials').field('source_type','document').field('slide_start',String(start)).field('slide_end',String(end)).field('original_visible_to_students','false').attach('file',resolve(document)).expect(202);
  await service.waitForJobs();const extracted=(await professor.get('/api/jobs/'+receipt.body.job_id)).body;
  if(extracted.status!=='completed')throw new Error(extracted.error?.message || '자료 처리 실패');
  console.log(JSON.stringify({stage:'extraction',status:'completed',start,end,provider}));
  const generation=await professor.post(base+'/quiz-drafts').set('Idempotency-Key',run+'-generate').send({material_ids:[receipt.body.material_id],question_count:count}).expect(202);
  await service.waitForJobs();const job=(await professor.get('/api/jobs/'+generation.body.job_id)).body;
  if(job.status!=='completed')throw new Error(job.error?.message || '생성 실패');
  const draft=(await professor.get('/api/quiz-drafts/'+job.result.draft_id)).body;
  console.log(JSON.stringify({stage:'generation',status:'completed',questions:draft.questions.length,provider}));
  const selected=draft.questions.slice(0,Math.min(5,count));
  const published=await professor.post('/api/quiz-drafts/'+draft.draft_id+'/publish').set('Idempotency-Key',run+'-publish').send({expected_version:draft.version,question_ids:selected.map((q:{question_id:string})=>q.question_id)}).expect(201);
  const student=request.agent(service.app);await student.post('/api/dev/login').send({user_id:IDS.student}).expect(200);
  const quiz=(await student.get('/api/quizzes/'+published.body.quiz_id).expect(200)).body;
  if(/correct_option_id|explanation/.test(JSON.stringify(quiz)))throw new Error('정답 노출');
  const result=await student.post('/api/quizzes/'+quiz.quiz_id+'/attempts').set('Idempotency-Key',run+'-attempt').send({answers:selected.map((q:{question_id:string;correct_option_id:string;options:{option_id:string}[]},i:number)=>({question_id:q.question_id,option_id:i===0?q.correct_option_id:q.options.find(o=>o.option_id!==q.correct_option_id)!.option_id}))}).expect(201);
  if(result.body.correct_count!==1 || result.body.wrong_questions.length!==selected.length-1)throw new Error('채점 결과 불일치');
  console.log(JSON.stringify({stage:'live_flow',status:'passed',provider,generated_count:draft.questions.length,published_count:quiz.questions.length,correct_count:result.body.correct_count,wrong_count:result.body.wrong_questions.length,quiz_id:quiz.quiz_id}));
} finally {await service.close()}
