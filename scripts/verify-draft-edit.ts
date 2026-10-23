/** Clone an existing local draft into a temporary DB; never edit/publish the user's original. */
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import request from 'supertest';
import {createApp} from '../backend/src/app.js';
import {IDS} from '../backend/src/store.js';
import type {QuizDraft} from '../backend/src/types.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const db=new DatabaseSync(resolve(root,'.data/campus.sqlite'),{readOnly:true});
const row=db.prepare('SELECT d.data FROM drafts d WHERE d.course_id=? AND d.week_id=? AND NOT EXISTS(SELECT 1 FROM quizzes q WHERE q.draft_id=d.id) ORDER BY d.rowid DESC LIMIT 1').get(IDS.course,IDS.week) as {data:string}|undefined;db.close();
if(!row)throw new Error('로컬 첫 주차에 미게시 초안이 필요합니다.');const original=JSON.parse(row.data) as QuizDraft;
const directory=mkdtempSync(resolve(tmpdir(),'campus-verify-edit-')),service=createApp({root,dataDir:directory,demoAuth:true});
try {
 service.store.run('INSERT INTO drafts VALUES (?,?,?,?)',original.draft_id,IDS.course,IDS.week,row.data);
 const prof=request.agent(service.app),student=request.agent(service.app),other=request.agent(service.app);
 for(const [agent,user] of [[prof,IDS.professor],[student,IDS.student],[other,IDS.student2]] as const)await agent.post('/api/dev/login').send({user_id:user}).expect(200);
 const draft=(await prof.get('/api/quiz-drafts/'+original.draft_id).expect(200)).body as QuizDraft,q=draft.questions[0],correct=q.options.find(o=>o.option_id!==q.correct_option_id)!.option_id;
 const saved=(await prof.patch(`/api/quiz-drafts/${draft.draft_id}/questions/${q.question_id}`).set('Idempotency-Key',crypto.randomUUID()).send({expected_version:draft.version,prompt:q.prompt+' (임시 수정 검증)',options:q.options.map(o=>({...o,text:o.text+' (검토)'})),correct_option_id:correct,explanation:'임시 수정 검증: '+q.explanation}).expect(200)).body as QuizDraft;
 if(saved.version!==draft.version+1||JSON.stringify(saved.questions[0].sources)!==JSON.stringify(q.sources))throw new Error('EDIT_SOURCE_OR_VERSION_CHANGED');
 const posted=(await prof.post(`/api/quiz-drafts/${draft.draft_id}/publish`).set('Idempotency-Key',crypto.randomUUID()).send({expected_version:saved.version,question_ids:[q.question_id]}).expect(201)).body;
 const publicQuiz=(await student.get('/api/quizzes/'+posted.quiz_id).expect(200)).body;if(/correct_option_id|explanation|sources/.test(JSON.stringify(publicQuiz)))throw new Error('ANSWER_LEAK');
 const wrong=(await student.post(`/api/quizzes/${posted.quiz_id}/attempts`).set('Idempotency-Key',crypto.randomUUID()).send({answers:[{question_id:q.question_id,option_id:q.correct_option_id}]}).expect(201)).body;
 const right=(await other.post(`/api/quizzes/${posted.quiz_id}/attempts`).set('Idempotency-Key',crypto.randomUUID()).send({answers:[{question_id:q.question_id,option_id:correct}]}).expect(201)).body;
 if(wrong.correct_count!==0||wrong.wrong_questions[0].correct_option_id!==correct||wrong.wrong_questions[0].explanation!==saved.questions[0].explanation||right.correct_count!==1)throw new Error('EDITED_GRADING_MISMATCH');
 const report=(await prof.get(`/api/courses/${IDS.course}/reports/quizzes`).expect(200)).body;
 if(report.summary.correct_rate!==.5||report.weeks[0].questions[0].prompt!==saved.questions[0].prompt)throw new Error('REPORT_MISMATCH');
 const record={status:'passed',source_draft:original.draft_id,source_questions:original.questions.length,version_before:draft.version,version_after:saved.version,edited_fields:['prompt','options','correct_option_id','explanation'],sources_preserved:true,published_questions:1,old_answer_correct_count:wrong.correct_count,new_answer_correct_count:right.correct_count,report_correct_rate:report.summary.correct_rate,model_configured:(await prof.get('/api/health')).body.ai_configured,original_draft_modified:false};
 mkdirSync(resolve(root,'.data/verification-draft-edit'),{recursive:true});writeFileSync(resolve(root,'.data/verification-draft-edit/result.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));
}finally{await service.close();rmSync(directory,{recursive:true,force:true})}
