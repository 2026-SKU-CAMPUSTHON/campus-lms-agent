/** 실제 ASR·Jev·생성 제공자로 미디어 흐름을 검증한다. 원문·키·생성 본문은 출력하지 않는다. */
import request from 'supertest';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,extname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config} from 'dotenv';
import {createApp} from '../backend/src/app.js';
import {generationConfig} from '../backend/src/ai/config.js';
import {IDS} from '../backend/src/store.js';
const root=fileURLToPath(new URL('../',import.meta.url));config({path:resolve(root,'.env'),quiet:true});
const file=process.argv[2];if(!file)throw new Error('사용할 녹음·동영상의 로컬 경로를 주세요.');
const visible=process.argv[3]==='public',kind=/\.(mp4|mov|webm|mkv)$/i.test(file)?'video':'audio';
if(!process.env.TYPESAFE_API_KEY)throw new Error('실제 Jev 키가 필요합니다.');
process.env.WHISPER_CACHE_DIR=process.env.WHISPER_CACHE_DIR || resolve(root,'.data/models');
const dir=mkdtempSync(resolve(tmpdir(),'campus-live-media-'));
const app=createApp({root,dataDir:dir,demoAuth:true,...generationConfig(),jevApiKey:process.env.TYPESAFE_API_KEY,jevModel:process.env.JEV_MODEL});
const base=`/api/courses/${IDS.course}/weeks/${IDS.week}`;
try {
 const professor=request.agent(app.app),student=request.agent(app.app);await professor.post('/api/dev/login').send({user_id:IDS.professor}).expect(200);await student.post('/api/dev/login').send({user_id:IDS.student}).expect(200);
 const receipt=await professor.post(base+'/media').field('source_type',kind).field('original_visible_to_students',String(visible)).attach('file',resolve(file)).expect(202);await app.waitForJobs();
 const job=(await professor.get('/api/jobs/'+receipt.body.job_id)).body;if(job.status!=='completed')throw new Error(job.error?.code || 'TRANSCRIPTION_NOT_COMPLETED');
 const transcript=(await professor.get(`/api/materials/${receipt.body.material_id}/transcript`).expect(200)).body;
 await student.get(`/api/materials/${receipt.body.material_id}/transcript`).expect(visible?200:403);await student.get(`/api/materials/${receipt.body.material_id}/playback`).set('Range','bytes=0-31').expect(visible?206:403);
 await professor.get(`/api/materials/${receipt.body.material_id}/playback`).set('Range','bytes=0-31').expect(206);
 const question=await student.post(base+'/threads').set('Idempotency-Key',crypto.randomUUID()).send({text:process.argv[4] || '정규화는 어떤 문제를 방지하기 위한 과정인가요?'}).expect(201);await app.waitForJobs();
 const thread=(await student.get('/api/threads/'+question.body.thread_id)).body;
 if(thread.state!=='resolved'){const trace=(await professor.get(`/api/threads/${thread.thread_id}/decisions`)).body;console.log(JSON.stringify({stage:'judgment',state:thread.state,handoff_reason:thread.handoff_reason,decision:trace.at(-1)?.decision,error:thread.error?.code}));throw new Error(thread.error?.code || 'QA_NOT_RESOLVED_'+thread.state)}
 const answer=thread.messages.at(-1);
 if(!answer.sources.length || answer.sources.some((s:any)=>s.source_type!=='transcript'||s.slide_no!==null||s.start_sec<0||s.end_sec>transcript.duration_sec||s.end_sec<=s.start_sec))throw new Error('INVALID_TIME_SOURCE');
 const report=(await professor.get(`/api/courses/${IDS.course}/reports/qa`).expect(200)).body;if(report.threads[0].messages.at(-1).sources[0].source_type!=='transcript')throw new Error('REPORT_SOURCE_MISSING');
 const record={status:'passed',provider:generationConfig().provider,source_type:kind,original_visible:visible,duration_sec:transcript.duration_sec,language:transcript.language,segments:transcript.segments.length,answer_characters:answer.text.length,cited_times:answer.sources.map((s:any)=>({start_sec:s.start_sec,end_sec:s.end_sec})),playback_range:true,report_source:true};
 mkdirSync(resolve(root,'.data/verification-media'),{recursive:true});writeFileSync(resolve(root,'.data/verification-media',basename(file,extname(file))+'-'+kind+'-flow.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));
}finally{await app.close();rmSync(dir,{recursive:true,force:true})}
