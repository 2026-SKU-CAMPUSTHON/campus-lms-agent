/** Real model generation from an existing YouTube transcript. Publish/grade only in a temporary DB. */
import request from 'supertest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config} from 'dotenv';
import {createApp} from '../backend/src/app.js';
import {generationConfig} from '../backend/src/ai/config.js';
import {IDS} from '../backend/src/store.js';
import type {MediaMaterial,QuizDraft} from '../backend/src/types.js';
const root=fileURLToPath(new URL('../',import.meta.url));config({path:resolve(root,'.env'),quiet:true});
const video=process.argv[2]||'XwsPTAnFRsk',count=Number(process.argv[3]||5);
const db=new DatabaseSync(resolve(root,process.env.DATA_DIR||'.data','campus.sqlite'),{readOnly:true});
const row=db.prepare("SELECT data FROM materials WHERE course_id=? AND week_id=? AND json_extract(data,'$.youtube.video_id')=? AND json_extract(data,'$.status')='completed' ORDER BY rowid DESC LIMIT 1").get(IDS.course,IDS.week,video) as {data:string}|undefined;db.close();
if(!row)throw new Error('완료된 첫 주차 YouTube 자료가 필요합니다.');const material=JSON.parse(row.data) as MediaMaterial;
const directory=mkdtempSync(resolve(tmpdir(),'campus-live-youtube-quiz-')),settings=generationConfig();
const service=createApp({root,dataDir:directory,demoAuth:true,...settings});const base=`/api/courses/${IDS.course}/weeks/${IDS.week}`,run=crypto.randomUUID();
try {
 service.store.run('INSERT INTO materials VALUES (?,?,?,?)',material.material_id,material.course_id,material.week_id,JSON.stringify(material));
 const professor=request.agent(service.app),student=request.agent(service.app),student2=request.agent(service.app),outsider=request.agent(service.app);
 for(const [agent,user] of [[professor,IDS.professor],[student,IDS.student],[student2,IDS.student2],[outsider,IDS.outsider]] as const)await agent.post('/api/dev/login').send({user_id:user}).expect(200);
 const receipt=(await professor.post(base+'/quiz-drafts').set('Idempotency-Key',run+'-generate').send({material_ids:[material.material_id],question_count:count}).expect(202)).body;await service.waitForJobs();
 const job=(await professor.get('/api/jobs/'+receipt.job_id)).body;if(job.status!=='completed')throw new Error(job.error?.code||'GENERATION_NOT_COMPLETED');
 const draft=(await professor.get('/api/quiz-drafts/'+job.result.draft_id).expect(200)).body as QuizDraft;
 if(draft.questions.length!==count||draft.questions.some(q=>!q.sources.length||q.sources.some(s=>s.source_type!=='transcript'||s.origin!=='youtube'||s.slide_no!==null||s.start_sec<material.youtube!.start_sec||s.end_sec>(material.youtube!.end_sec??material.duration_sec!))))throw new Error('INVALID_TIME_SOURCE');
 const chosen=draft.questions.slice(0,Math.min(2,count));
 const published=(await professor.post(`/api/quiz-drafts/${draft.draft_id}/publish`).set('Idempotency-Key',run+'-publish').send({question_ids:chosen.map(q=>q.question_id)}).expect(201)).body;
 await student.get('/api/quiz-drafts/'+draft.draft_id).expect(403);await student.get(`/api/materials/${material.material_id}/original`).expect(material.original_visible_to_students?302:403);
 const quiz=(await student.get('/api/quizzes/'+published.quiz_id).expect(200)).body;
 if(quiz.questions.length!==chosen.length||/correct_option_id|explanation|sources/.test(JSON.stringify(quiz)))throw new Error('UNPUBLISHED_QUESTION_OR_ANSWER_LEAK');
 const result=(await student.post(`/api/quizzes/${published.quiz_id}/attempts`).set('Idempotency-Key',run+'-attempt').send({answers:chosen.map((q,i)=>({question_id:q.question_id,option_id:i===0?q.correct_option_id:q.options.find(o=>o.option_id!==q.correct_option_id)!.option_id}))}).expect(201)).body;
 if(result.correct_count!==1||result.wrong_questions.length!==chosen.length-1||result.wrong_questions.some((q:any)=>!q.explanation||q.sources[0].origin!=='youtube'))throw new Error('WRONG_ANSWER_MISMATCH');
 if((await student.get('/api/me/attempts')).body[0].attempt_id!==result.attempt_id||(await student2.get('/api/me/attempts')).body.length)throw new Error('ATTEMPT_ISOLATION_FAILED');await outsider.get('/api/quizzes/'+published.quiz_id).expect(403);
 const report=(await professor.get(`/api/courses/${IDS.course}/reports/quizzes`).expect(200)).body;if(report.summary.correct_rate!==1/chosen.length||report.weeks[0].questions.some((q:any)=>q.sources[0].origin!=='youtube'))throw new Error('REPORT_MISMATCH');
 const record={status:'passed',provider:settings.provider,video_id:video,selected_start:material.youtube!.start_sec,selected_end:material.youtube!.end_sec??material.duration_sec,generated_count:draft.questions.length,published_count:chosen.length,correct_count:result.correct_count,wrong_count:result.wrong_questions.length,source_ranges:draft.questions.map(q=>q.sources.map(s=>({start_sec:s.start_sec,end_sec:s.end_sec}))),private_original:!material.original_visible_to_students,report_correct_rate:report.summary.correct_rate};
 mkdirSync(resolve(root,'.data/verification-youtube-quiz'),{recursive:true});writeFileSync(resolve(root,'.data/verification-youtube-quiz',video+'-flow.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));
}finally{await service.close();rmSync(directory,{recursive:true,force:true})}
