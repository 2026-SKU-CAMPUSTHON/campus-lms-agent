/** Real YouTube import + Jev + generation in an isolated DB. No evidence bodies in logs. */
import request from 'supertest';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config} from 'dotenv';
import {createApp} from '../backend/src/app.js';
import {generationConfig} from '../backend/src/ai/config.js';
import {parseYouTubeUrl} from '../backend/src/media/youtube-url.js';
import {IDS} from '../backend/src/store.js';
const root=fileURLToPath(new URL('../',import.meta.url));config({path:resolve(root,'.env'),quiet:true});
const link=parseYouTubeUrl(process.argv[2]||''),visible=process.argv[3]==='public',end=process.argv[4]?Number(process.argv[4]):null;
if(!process.env.TYPESAFE_API_KEY)throw new Error('실제 Jev 키가 필요합니다.');
process.env.WHISPER_CACHE_DIR=process.env.WHISPER_CACHE_DIR||resolve(root,'.data/models');
const dir=mkdtempSync(resolve(tmpdir(),'campus-live-youtube-'));
const app=createApp({root,dataDir:dir,demoAuth:true,...generationConfig(),jevApiKey:process.env.TYPESAFE_API_KEY,jevModel:process.env.JEV_MODEL});
const base=`/api/courses/${IDS.course}/weeks/${IDS.week}`;
try {
 const professor=request.agent(app.app),student=request.agent(app.app);await professor.post('/api/dev/login').send({user_id:IDS.professor}).expect(200);await student.post('/api/dev/login').send({user_id:IDS.student}).expect(200);
 const receipt=(await professor.post(base+'/youtube').send({url:process.argv[2],end_sec:end,original_visible_to_students:visible}).expect(202)).body;await app.waitForJobs();
 const job=(await professor.get('/api/jobs/'+receipt.job_id)).body;if(job.status!=='completed')throw new Error(job.error?.code||'IMPORT_NOT_COMPLETED');
 const transcript=(await professor.get(`/api/materials/${receipt.material_id}/transcript`).expect(200)).body;
 if(!transcript.segments.length||transcript.segments.some((s:any)=>s.start_sec<link.start_sec||s.end_sec>(end??transcript.duration_sec)))throw new Error('INVALID_RANGE');
 await student.get(`/api/materials/${receipt.material_id}/transcript`).expect(visible?200:403);
 await student.get(`/api/materials/${receipt.material_id}/playback`).expect(visible?302:403);
 const playback=await professor.get(`/api/materials/${receipt.material_id}/playback`).expect(302);if(playback.headers.location!==link.url+`&t=${link.start_sec}s`)throw new Error('INVALID_PLAYBACK_TIME');
 const question=await student.post(base+'/threads').set('Idempotency-Key',crypto.randomUUID()).send({text:process.argv[5]||'강의에서 설명한 공학수학 학습의 중장기 목표는 무엇인가요?'}).expect(201);await app.waitForJobs();
 const thread=(await student.get('/api/threads/'+question.body.thread_id)).body;
 if(thread.state!=='resolved'){console.log(JSON.stringify({state:thread.state,handoff_reason:thread.handoff_reason,error:thread.error?.code}));throw new Error(thread.error?.code||'QA_NOT_RESOLVED')}
 const answer=thread.messages.at(-1);if(!answer.sources.length||answer.sources.some((s:any)=>s.origin!=='youtube'||s.start_sec<link.start_sec))throw new Error('INVALID_YOUTUBE_SOURCE');
 const report=(await professor.get(`/api/courses/${IDS.course}/reports/qa`).expect(200)).body;if(report.threads[0].messages.at(-1).sources[0].origin!=='youtube')throw new Error('REPORT_SOURCE_MISSING');
 const content=(await professor.get(base+'/content')).body,m=content.materials.find((m:any)=>m.material_id===receipt.material_id);
 const record={status:'passed',provider:generationConfig().provider,video_id:link.video_id,method:m.youtube.method,is_generated:m.youtube.is_generated,original_visible:visible,duration_sec:transcript.duration_sec,selected_start:link.start_sec,selected_end:end??transcript.duration_sec,language:transcript.language,segments:transcript.segments.length,answer_characters:answer.text.length,cited_times:answer.sources.map((s:any)=>({start_sec:s.start_sec,end_sec:s.end_sec})),playback_redirect:true,report_source:true};
 mkdirSync(resolve(root,'.data/verification-youtube'),{recursive:true});writeFileSync(resolve(root,'.data/verification-youtube',link.video_id+'-flow.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));
}finally{await app.close();rmSync(dir,{recursive:true,force:true})}
