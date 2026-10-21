/** 실제 모델을 호출하는 수동 검증. 키·원문·생성 본문을 출력하지 않는다. */
import request from 'supertest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config} from 'dotenv';
import {createApp} from '../backend/src/app.js';
import {generationConfig} from '../backend/src/ai/config.js';
import {IDS} from '../backend/src/store.js';
import type {Material} from '../backend/src/types.js';
import type {QAThread} from '../backend/src/qa/types.js';
const root=fileURLToPath(new URL('../',import.meta.url));config({path:resolve(root,'.env'),quiet:true});
const settings=generationConfig();
if(!['claude','codex'].includes(settings.provider)||!process.env.TYPESAFE_API_KEY)throw new Error('Claude/Codex와 실제 TypeSafe 키를 설정하세요.');
const source=new DatabaseSync(resolve(root,'.data/campus.sqlite'),{readOnly:true});
const materials=source.prepare('SELECT data FROM materials WHERE course_id=? AND week_id=?').all(IDS.course,IDS.week).map(row=>JSON.parse(String(row.data)) as Material).filter(m=>m.status==='completed');source.close();
if(!materials.length)throw new Error('먼저 첫 주차의 실제 강의 자료를 등록하세요.');
const directory=mkdtempSync(resolve(tmpdir(),'campus-live-qa-'));
const service=createApp({root,dataDir:directory,demoAuth:true,...settings,jevApiKey:process.env.TYPESAFE_API_KEY,jevModel:process.env.JEV_MODEL,jevMinimum:Number(process.env.JEV_MIN_CONFIDENCE || .75)});
for(const m of materials)service.store.run('INSERT INTO materials VALUES (?,?,?,?)',m.material_id,m.course_id,m.week_id,JSON.stringify(m));
const base=`/api/courses/${IDS.course}/weeks/${IDS.week}/threads`;
const results:Record<string,unknown>[]=[];
function check(condition:unknown,code:string):asserts condition {if(!condition)throw new Error(code)}
try {
 const student=request.agent(service.app),professor=request.agent(service.app);
 await student.post('/api/dev/login').send({user_id:IDS.student}).expect(200);await professor.post('/api/dev/login').send({user_id:IDS.professor}).expect(200);
 async function ask(text:string) {
  const posted=await student.post(base).set('Idempotency-Key',crypto.randomUUID()).send({text}).expect(201);await service.waitForJobs();
  const thread=(await student.get('/api/threads/'+posted.body.thread_id).expect(200)).body as QAThread;
  check(!thread.error,thread.error?.code || 'QA_FAILED');return thread;
 }
 const clear=await ask('TF-IDF에서 IDF는 무엇을 의미하나요?');check(clear.state==='resolved','CLEAR_NOT_RESOLVED');check(clear.messages.at(-1)?.sources.length,'MISSING_SOURCE');
 results.push({case:'grounded_answer',state:clear.state,clarification_count:clear.clarification_count,cited_pages:clear.messages.at(-1)!.sources.map(s=>s.slide_no)});
 const ambiguous=await ask('그거요. 이게 뭔지 모르겠어요.');check(ambiguous.state==='awaiting_student'&&ambiguous.clarification_count===1,'MISSING_CLARIFICATION');
 await student.post(`/api/threads/${ambiguous.thread_id}/messages`).set('Idempotency-Key',crypto.randomUUID()).send({text:'그거요. 여전히 어떤 개념인지 모르겠어요.',expected_version:ambiguous.version}).expect(202);await service.waitForJobs();
 const handoff=(await student.get('/api/threads/'+ambiguous.thread_id)).body as QAThread;check(!handoff.error,handoff.error?.code||'FOLLOWUP_FAILED');check(handoff.state==='awaiting_professor','MISSING_HANDOFF');check(handoff.messages.filter(m=>m.kind==='clarification').length===1,'EXTRA_CLARIFICATION');
 const reply=await professor.post(`/api/threads/${handoff.thread_id}/messages`).set('Idempotency-Key',crypto.randomUUID()).send({text:'질문의 대상을 수업에서 함께 확인하고 설명하겠습니다.',expected_version:handoff.version}).expect(200);check(reply.body.state==='resolved','PROFESSOR_REPLY_FAILED');
 results.push({case:'clarify_once_then_professor',state:handoff.state,handoff_reason:handoff.handoff_reason,clarification_count:handoff.clarification_count,professor_reply:reply.body.state});
 const unsupported=await ask('이 자료에서 다루지 않는 화성의 오늘 기온은 몇 도인가요?');check(unsupported.state==='awaiting_professor','UNSUPPORTED_NOT_ESCALATED');
 results.push({case:'unsupported_question',state:unsupported.state,handoff_reason:unsupported.handoff_reason,clarification_count:unsupported.clarification_count});
 const record={at:new Date().toISOString(),provider:settings.provider,model:settings.model,jev_model:process.env.JEV_MODEL || 'jev-1.13.0',status:'passed',results};
 writeFileSync(resolve(root,'.data/live-qa-verification.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));
} finally {await service.close();rmSync(directory,{recursive:true,force:true})}
