/** Explicit, paid-model evaluation in isolated local databases. Never reads reviewer labels. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,join,relative,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {config} from 'dotenv';
import request from 'supertest';
import {createApp} from '../../backend/src/app.js';
import {IDS} from '../../backend/src/store.js';
import {extractDocument} from '../../backend/src/quiz-generation/extract.js';
import {createClaudeGenerator} from '../../backend/src/quiz-generation/claude.js';
import {createClaudeTranscriptGenerator} from '../../backend/src/quiz-generation/transcript.js';
import {createQAClaudeGenerator} from '../../backend/src/qa/generate.js';
import {createJevJudge} from '../../backend/src/qa/jev.js';
import {DEFAULT_CLAUDE_MODEL} from '../../backend/src/ai/claude-json.js';
import {HttpError} from '../../backend/src/errors.js';
import type {Material,TranscriptSegment} from '../../backend/src/types.js';
import type {JudgeInput,Decision,StoredThread} from '../../backend/src/qa/types.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
config({path:join(root,'.env'),quiet:true});
const [mode,runName,pdfPath,captionPath]=process.argv.slice(2);
assert(['prepare','execute'].includes(mode),'Use prepare|execute <run_id> [PDF path] [caption snapshot path]');
assert(runName&&/^[a-zA-Z0-9_-]+$/.test(runName),'Use a simple unique run ID');
const directory=join(root,'.data/evaluation-runs',runName);
const data=join(root,'evaluation/v1');
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const read=<T=any>(path:string):T=>JSON.parse(readFileSync(path,'utf8'));
function save(path:string,value:unknown) {mkdirSync(resolve(path,'..'),{recursive:true,mode:0o700});writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'})}
const manifest=read(join(data,'source-manifest.json'));
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const model=process.env.ANTHROPIC_MODEL||DEFAULT_CLAUDE_MODEL;
const jevModel=process.env.JEV_MODEL||'jev-1.13.0';
const minimum=Number(process.env.JEV_MIN_CONFIDENCE||.75);
const inputs=(split:string)=>readFileSync(join(data,`qa-${split}-inputs.jsonl`),'utf8').trim().split('\n').map(x=>{
 const row=JSON.parse(x);assert.deepEqual(Object.keys(row).sort(),['case_id','question','scope_id','student_followup']);return row as {case_id:string;question:string;scope_id:string;student_followup:string|null};
});

if(mode==='prepare') {
 assert(!existsSync(directory),'Never overwrite an existing run');
 assert(pdfPath&&captionPath,'Provide original PDF and existing caption snapshot');
 assert.equal(hash(readFileSync(pdfPath)),manifest.sources.find((s:any)=>s.source_id==='PDF_TEXT').sha256,'PDF snapshot mismatch');
 const video=read(captionPath);
 const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 assert.equal(hash(JSON.stringify(canonical(video.segments))),manifest.sources.find((s:any)=>s.source_id==='YT_MATH').segments_sha256,'Caption snapshot mismatch');
 const materials:Record<string,Material>={};
 for(const scope of manifest.scopes) {
  const base={material_id:randomUUID(),week_id:randomUUID(),course_id:scope.pages?IDS.course:IDS.otherCourse,name:scope.pages?basename(pdfPath):video.name,original_visible_to_students:false,status:'completed' as const};
  if(scope.pages) {
   const extracted=await extractDocument(resolve(pdfPath),scope.pages[0],scope.pages[1],root);
   assert.equal(extracted.total_slides,60);
   materials[scope.scope_id]={...base,source_type:'document',slide_start:scope.pages[0],slide_end:scope.pages[1],total_slides:extracted.total_slides,slides:extracted.slides,file_path:resolve(pdfPath)};
  } else {
   // Keep complete boundary cues with timestamps clipped to the selected interval.
   // Text within a caption cue cannot be aligned to individual words; document this limit.
   const [start,end]=scope.seconds;
   const segments=video.segments.filter((s:TranscriptSegment)=>s.end_sec>start&&s.start_sec<end).map((s:TranscriptSegment)=>({...s,start_sec:Math.max(start,s.start_sec),end_sec:Math.min(end,s.end_sec)}));
   assert(segments.length);
   materials[scope.scope_id]={...base,source_type:'video',slide_start:null,slide_end:null,total_slides:null,slides:[],file_path:'',duration_sec:video.duration_sec,language:'ko',segments,job_id:randomUUID(),error:null,youtube:{...video.youtube,start_sec:start,end_sec:end}};
  }
 }
 mkdirSync(directory,{recursive:true,mode:0o700});
 save(join(directory,'materials.json'),materials);
 const hashes=Object.fromEntries(readdirSync(data).filter(n=>/\.(json|jsonl)$/.test(n)).map(n=>[n,hash(readFileSync(join(data,n)))]));
 save(join(directory,'metadata.json'),{run_id:runName,prepared_at:new Date().toISOString(),code_commit:commit,runner_sha256:hash(readFileSync(fileURLToPath(import.meta.url))),dataset_version:manifest.version,dataset_hashes:hashes,materials_sha256:hash(readFileSync(join(directory,'materials.json'))),source_hashes:manifest.sources.map((s:any)=>({id:s.source_id,hash:s.sha256||s.segments_sha256})),model,jev_model:jevModel,minimum,retrieval_limit:6,max_tokens:16000,retries:0,temperature:'provider default (not explicitly set)',labels:'candidate; no independent human approval',grading:'AI provisional; not a human-validated benchmark',caption_boundary_policy:'clip cue timestamps, preserve full cue text; word-level alignment unavailable',cost_usd:null,database:'isolated SQLite; not production MySQL load testing'});
 inputs('dev');inputs('final');
 console.log(JSON.stringify({stage:'prepared',run_id:runName,scopes:Object.keys(materials),models:{claude:model,jev:jevModel},keys_present:{claude:!!process.env.ANTHROPIC_API_KEY,jev:!!process.env.TYPESAFE_API_KEY}}));
} else {
 assert(process.env.ANTHROPIC_API_KEY&&process.env.TYPESAFE_API_KEY,'Both real API keys are required');
 const metadata=read(join(directory,'metadata.json'));
 assert.equal(metadata.model,model);assert.equal(metadata.jev_model,jevModel);assert.equal(metadata.minimum,minimum);
 assert.equal(metadata.code_commit,commit,'Code changed since preparation');
 assert.equal(metadata.runner_sha256,hash(readFileSync(fileURLToPath(import.meta.url))),'Runner changed since preparation');
 for(const [name,expected] of Object.entries(metadata.dataset_hashes))assert.equal(hash(readFileSync(join(data,name))),expected,`Dataset changed: ${name}`);
 assert.equal(hash(readFileSync(join(directory,'materials.json'))),metadata.materials_sha256);
 save(join(directory,'execution-started.json'),{at:new Date().toISOString()});
 const materials=read<Record<string,Material>>(join(directory,'materials.json'));
 const arms=['direct_answer','jev_gate'] as const;
 let callNumber=0;
 const apiRecords:any[]=[];
 const services:any={};
 function transport(provider:string,context:{label:string}):typeof fetch {
  return async(url,init)=>{
   const call=++callNumber,started=performance.now(),label=context.label;
   const requestBody=typeof init?.body==='string'?JSON.parse(init.body):null;
   // Headers, cookies, credentials and transport errors are never serialized.
   const record:any={call,provider,label,started_at:new Date().toISOString(),request:requestBody};
   try {
    const response=await fetch(url,init);record.http_status=response.status;
    if(response.ok) {const raw=await response.clone().text();try{record.response=JSON.parse(raw)}catch{record.response_parse_failed=true}}
    record.duration_ms=performance.now()-started;
    save(join(directory,'calls',String(call).padStart(4,'0')+'.json'),record);apiRecords.push(record);
    return response;
   } catch(error) {
    record.duration_ms=performance.now()-started;record.transport_error=error instanceof Error?error.name:'UnknownError';
    save(join(directory,'calls',String(call).padStart(4,'0')+'.json'),record);apiRecords.push(record);throw error;
   }
  };
 }
 function haltOnCredentialError(error:{code?:string}|null|undefined) {
  if(error?.code&&['AI_AUTH_FAILED','AI_LIMIT','AI_REQUEST_REJECTED','AI_MODEL_UNAVAILABLE','JEV_AUTH_FAILED','JEV_LIMIT'].includes(error.code))throw new Error('STOP_API_CONFIGURATION_OR_QUOTA:'+error.code);
 }
 try {
  for(const arm of arms) {
   const context={label:'initialization'},observations:any[]=[];
   const options={apiKey:process.env.ANTHROPIC_API_KEY,model,transport:transport('claude',context)};
   const realJudge=createJevJudge(process.env.TYPESAFE_API_KEY,jevModel,transport('jev',context));
   const judge=async(input:JudgeInput):Promise<Decision>=>{
    observations.push({label:context.label,at:new Date().toISOString(),input,passages_sha256:hash(JSON.stringify(input.passages))});
    if(arm==='jev_gate')return realJudge(input);
    // This constant bypasses the learned judge only. Server no-passage and no-citation
    // fallback remains active. Values below are NOT measured confidence scores.
    return {model:'baseline-bypass-no-judge',clarity:{label:'clear',confidence:1,probabilities:{clear:1,unclear:0}},evidence:{label:'sufficient',confidence:1,probabilities:{sufficient:1,insufficient:0}}};
   };
   const app=createApp({root,dataDir:join(directory,arm+'-db'),demoAuth:true,provider:'claude',apiKey:options.apiKey,model,generator:createClaudeGenerator(options),transcriptGenerator:createClaudeTranscriptGenerator(options),qaGenerator:createQAClaudeGenerator(options),qaJudge:judge,jevMinimum:minimum});
   await app.initialized;
   for(const user of [IDS.professor,IDS.student])app.store.run('INSERT OR REPLACE INTO memberships VALUES (?,?,?)',user,IDS.otherCourse,user===IDS.professor?'professor':'student');
   for(const [i,[scope,m]] of Object.entries(materials).entries()) {
    app.store.run('INSERT INTO weeks VALUES (?,?,?,?)',m.week_id,m.course_id,i+10,scope);
    app.store.run('INSERT INTO materials VALUES (?,?,?,?)',m.material_id,m.course_id,m.week_id,JSON.stringify(m));
   }
   const student=request.agent(app.app),professor=request.agent(app.app);
   await student.post('/api/dev/login').send({user_id:IDS.student}).expect(200);
   await professor.post('/api/dev/login').send({user_id:IDS.professor}).expect(200);
   services[arm]={app,student,professor,context,observations};
  }
  async function qaCase(row:ReturnType<typeof inputs>[number],arm:typeof arms[number],split:string) {
   const s=services[arm],m=materials[row.scope_id];
   s.context.label=`${split}/${row.case_id}/${arm}`;
   const observationStart=s.observations.length,callStart=apiRecords.length;
   const durations:number[]=[];
   let start=performance.now();
   const posted=await s.student.post(`/api/courses/${m.course_id}/weeks/${m.week_id}/threads`).set('Idempotency-Key',randomUUID()).send({text:row.question}).expect(201);
   await s.app.waitForJobs();
   let thread=JSON.parse(s.app.store.get('SELECT data FROM threads WHERE id=?',posted.body.thread_id).data) as StoredThread;
   durations.push(performance.now()-start);
   if(thread.state==='awaiting_student'&&thread.processing_status!=='failed'&&row.student_followup) {
    start=performance.now();
    await s.student.post(`/api/threads/${thread.thread_id}/messages`).set('Idempotency-Key',randomUUID()).send({text:row.student_followup,expected_version:thread.version}).expect(202);
    await s.app.waitForJobs();thread=JSON.parse(s.app.store.get('SELECT data FROM threads WHERE id=?',thread.thread_id).data);durations.push(performance.now()-start);
   }
   const path=thread.messages.filter(m=>m.kind==='clarification').map(()=>'clarify');
   if(thread.processing_status==='failed')path.push('error');else if(thread.state==='resolved')path.push('answer');else if(thread.state==='awaiting_professor')path.push('handoff');
   const result={case_id:row.case_id,scope_id:row.scope_id,arm,split,status:thread.processing_status==='failed'?'failed':'completed',actual_path:path.join('>'),clarification_count:thread.clarification_count,latency_ms:durations.reduce((a,b)=>a+b,0),turn_latencies_ms:durations,thread,observations:s.observations.slice(observationStart),calls:apiRecords.slice(callStart).map(c=>c.call),cost_usd:null};
   save(join(directory,split,`${row.case_id}_${arm}.json`),result);
   console.log(JSON.stringify({stage:split,case_id:row.case_id,arm,status:result.status,path:result.actual_path,seconds:Number((result.latency_ms/1000).toFixed(2)),error:thread.error?.code||null}));
   haltOnCredentialError(thread.error);
  }
  for(const [i,row] of inputs('dev').entries())for(const arm of i%2?[...arms].reverse():arms)await qaCase(row,arm,'dev');
  const quizService=services.jev_gate;
  for(const task of read(join(data,'quiz-generation-tasks.json')).tasks) {
   const m=materials[task.scope_id],s=quizService;
   s.context.label=`quiz/${task.batch_id}`;const callStart=apiRecords.length,start=performance.now();
   const posted=await s.professor.post(`/api/courses/${m.course_id}/weeks/${m.week_id}/quiz-drafts`).set('Idempotency-Key',randomUUID()).send({material_ids:[m.material_id],question_count:task.question_count}).expect(202);
   await s.app.waitForJobs();
   const job=(await s.professor.get(`/api/jobs/${posted.body.job_id}`).expect(200)).body;
   const draft=job.status==='completed'?(await s.professor.get(`/api/quiz-drafts/${job.result.draft_id}`).expect(200)).body:null;
   const result={batch_id:task.batch_id,scope_id:task.scope_id,requested_count:task.question_count,status:job.status,error:job.error,draft,latency_ms:performance.now()-start,calls:apiRecords.slice(callStart).map(c=>c.call),cost_usd:null};
   save(join(directory,'quiz',task.batch_id+'.json'),result);
   console.log(JSON.stringify({stage:'quiz',batch:task.batch_id,status:job.status,questions:draft?.questions.length||0,error:job.error?.code||null}));haltOnCredentialError(job.error);
  }
  for(const [i,row] of inputs('final').entries())for(const arm of i%2?[...arms].reverse():arms)await qaCase(row,arm,'final');
  save(join(directory,'execution-completed.json'),{at:new Date().toISOString(),calls:apiRecords.length,qa_final:60,qa_dev:12,quiz_batches:3});
  console.log(JSON.stringify({stage:'completed',run_id:runName,calls:apiRecords.length}));
 } finally {
  save(join(directory,'call-index.json'),apiRecords.map(c=>({call:c.call,provider:c.provider,label:c.label,http_status:c.http_status,duration_ms:c.duration_ms,model:c.response?.model,usage:c.response?.usage||null,transport_error:c.transport_error||null})));
  for(const s of Object.values(services) as any[])await s.app.close();
 }
}
