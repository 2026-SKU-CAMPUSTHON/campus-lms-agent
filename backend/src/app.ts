import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { z } from 'zod';
import { Store, IDS } from './store.js';
import { HttpError } from './errors.js';
import { extractDocument } from './quiz-generation/extract.js';
import { createGeminiGenerator } from './quiz-generation/gemini.js';
import { generateAcrossRange, type Generator } from './quiz-generation/questions.js';
import {generateYouTubeQuestions,createClaudeTranscriptGenerator,createCodexTranscriptGenerator,type TranscriptGenerator} from './quiz-generation/transcript.js';
import { codexReady, createCodexGenerator } from './quiz-generation/codex.js';
import { createOpenAIGenerator } from './quiz-generation/openai.js';
import {createClaudeGenerator} from './quiz-generation/claude.js';
import {DEFAULT_CLAUDE_MODEL} from './ai/claude-json.js';
import type {Provider} from './ai/config.js';
import {mountMedia} from './media/routes.js';
import type {Transcriber} from './media/transcribe.js';
import type {YouTubeImporter} from './media/youtube.js';
import {isDocument} from './types.js';
import {mountReports} from './reports/routes.js';
import {QAService} from './qa/service.js';
import {mountQA} from './qa/routes.js';
import {createJevJudge} from './qa/jev.js';
import {createQACodexGenerator,createQAClaudeGenerator} from './qa/generate.js';
import type {Judge,QAGenerator} from './qa/types.js';
import type { AttemptResult, Course, DraftQuestion, Job, Material, PublicQuiz, QuizDraft, Role, User, Week, WeekContent } from './types.js';

interface Row { id:string; course_id:string; week_id:string; data:string; draft_id?:string }
interface AuthedRequest extends Request { user:User }
export interface AppOptions { root:string; dataDir:string; demoAuth:boolean; apiKey?:string; model?:string; provider?:Provider; codexBin?:string; generator?:Generator; transcriptGenerator?:TranscriptGenerator; transcriber?:Transcriber; youtubeImporter?:YouTubeImporter; jevApiKey?:string; jevModel?:string; jevMinimum?:number; qaJudge?:Judge; qaGenerator?:QAGenerator; frontendDir?:string }
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const parse=<T>(row:{data:string}):T=>JSON.parse(row.data) as T;
const readDraft=(row:{data:string}):QuizDraft=>{const draft=parse<Omit<QuizDraft,'version'>&{version?:number}>(row);return {...draft,version:draft.version??1}};
const uuid=z.string().uuid();
const generationRequest=z.object({material_ids:z.array(uuid).min(1).max(5),question_count:z.number().int().min(1).max(50).default(50)}).strict();
const publishRequest=z.object({question_ids:z.array(uuid).min(1).max(50),expected_version:z.number().int().positive()}).strict();
const editQuestionRequest=z.object({expected_version:z.number().int().positive(),prompt:z.string().trim().min(1).max(2000),options:z.array(z.object({option_id:z.string().min(1).max(20),text:z.string().trim().min(1).max(1000)}).strict()).length(4),correct_option_id:z.string().min(1).max(20),explanation:z.string().trim().min(1).max(4000)}).strict();
const attemptRequest=z.object({answers:z.array(z.object({question_id:uuid,option_id:z.string().min(1).max(20)}).strict()).min(1).max(50)}).strict();
const field=(v:unknown)=>z.string().parse(v);

export function createApp(options:AppOptions) {
  // 이 단계는 로컬 실행 전용이다. 실제 배포에서 체험 로그인이 켜지는 것을 차단한다.
  if(!options.demoAuth) throw new Error('현재 첫 기능은 ENABLE_DEMO_AUTH=true 로컬 모드만 지원합니다. 실제 배포 전 Supabase Auth/DB를 연결해야 합니다.');
  mkdirSync(options.dataDir,{recursive:true});
  const store=new Store(resolve(options.dataDir,'campus.sqlite'));
  const app=express();
  const provider=options.provider || 'claude';
  const model=options.model || (provider==='claude'?DEFAULT_CLAUDE_MODEL:provider==='codex'?'Codex 기본 모델':provider==='openai'?'gpt-6.1-sol':'gemini-3.8-flash');
  const ready=Boolean(options.generator) || (provider==='codex'?codexReady(options.codexBin):Boolean(options.apiKey));
  const generate=options.generator ?? (provider==='claude'?createClaudeGenerator({apiKey:options.apiKey,model}):provider==='codex'?createCodexGenerator(options.codexBin,options.model):provider==='openai'?createOpenAIGenerator(options.apiKey,model):createGeminiGenerator(options.apiKey,model));
  const generateTranscript=options.transcriptGenerator??(provider==='claude'?createClaudeTranscriptGenerator({apiKey:options.apiKey,model}):createCodexTranscriptGenerator({binary:options.codexBin,model:options.model}));
  const qa=new QAService(store,options.qaJudge ?? createJevJudge(options.jevApiKey,options.jevModel),options.qaGenerator ?? (provider==='claude'?createQAClaudeGenerator({apiKey:options.apiKey,model}):provider==='codex'?createQACodexGenerator({binary:options.codexBin,model:options.model}):async()=>{throw new HttpError(503,'QA_PROVIDER_UNSUPPORTED','Q&A 생성은 Claude 또는 Codex 제공자로 설정해 주세요.',true)}),options.jevMinimum);
  const qaReady=Boolean(options.qaJudge || options.jevApiKey) && Boolean(options.qaGenerator || (['claude','codex'].includes(provider)&&ready));
  const active=new Set<Promise<void>>();
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:1,fields:8,parts:9},fileFilter:(_req,file,cb)=>cb(null,/\.(pptx|pdf)$/i.test(file.originalname))});
  // 이전 프로세스에서 끊긴 작업을 성공이나 무한 대기로 남기지 않는다.
  for(const row of store.all<Row>('SELECT * FROM jobs')) {
    const job=parse<Job>(row);
    if(job.status==='processing' || job.status==='queued') {
      job.status='failed';job.error={code:'PROCESS_INTERRUPTED',message:'서버가 다시 시작되어 작업이 중단되었습니다. 다시 시도해 주세요.',retryable:true};
      store.run('UPDATE jobs SET data=? WHERE id=?',JSON.stringify(job),row.id);
    }
  }
  for(const row of store.all<Row>('SELECT * FROM materials')) {
    const material=parse<Material>(row);
    if(material.status==='queued' || material.status==='processing') {material.status='failed';store.run('UPDATE materials SET data=? WHERE id=?',JSON.stringify(material),row.id)}
  }
  app.disable('x-powered-by');
  app.use((req,res,next)=> {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    const host=req.hostname;
    if(!['127.0.0.1','localhost','::1','[::1]'].includes(host)) return next(new HttpError(403,'LOCAL_ONLY','로컬 주소에서만 사용할 수 있습니다.'));
    if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin) {
      try { const origin=new URL(req.headers.origin);if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname) || !['http:','https:'].includes(origin.protocol)) throw new Error(); }
      catch {return next(new HttpError(403,'INVALID_ORIGIN','요청 출처를 확인할 수 없습니다.'))}
    }
    next();
  });
  app.use(express.json({limit:'128kb'}));
  app.get('/api/health',(_req,res)=>res.json({status:'ok',mode:'local-development',ai_configured:ready,provider,model,contract_version:'0.9.0-report-pdf.1',qa_configured:qaReady,jev_configured:Boolean(options.jevApiKey || options.qaJudge),jev_model:options.jevModel || 'jev-1.13.0'}));
  app.get('/api/dev/accounts',(_req,res)=>res.json(store.all<{user_id:string;name:string}>('SELECT id AS user_id,name FROM users WHERE id != ?',IDS.outsider)));
  app.post('/api/dev/login',(req,res)=> {
    const id=z.object({user_id:uuid}).strict().parse(req.body).user_id;
    const user=store.get<User>('SELECT id AS user_id,name FROM users WHERE id=?',id);
    if(!user) throw new HttpError(401,'INVALID_ACCOUNT','체험 계정을 선택해 주세요.');
    const token=randomBytes(32).toString('base64url');
    store.run('DELETE FROM sessions WHERE expires_at < ?',Date.now());
    store.run('INSERT INTO sessions VALUES (?,?,?)',hash(token),id,Date.now()+8*60*60*1000);
    res.cookie('campus_session',token,{httpOnly:true,sameSite:'strict',path:'/',maxAge:8*60*60*1000});res.json(user);
  });
  app.use('/api',(req,res,next)=> {
    const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('campus_session='))?.slice('campus_session='.length);
    const user=cookie && store.get<User>('SELECT u.id AS user_id,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',hash(cookie),Date.now());
    if(!user) return next(new HttpError(401,'LOGIN_REQUIRED','로그인 후 사용할 수 있습니다.'));
    (req as AuthedRequest).user=user;next();
  });
  const current=(req:Request)=>(req as AuthedRequest).user;
  const membership=(req:Request,course:string,required?:Role):Role=> {
    const row=store.get<{role:Role}>('SELECT role FROM memberships WHERE user_id=? AND course_id=?',current(req).user_id,course);
    if(!row || (required && row.role!==required)) throw new HttpError(403,'FORBIDDEN','이 강의의 해당 기능에 접근할 수 없습니다.');
    return row.role;
  };
  const weekFor=(req:Request,course:string,weekId:string,role?:Role)=> {
    membership(req,course,role);
    if(!store.get('SELECT id FROM weeks WHERE id=? AND course_id=?',weekId,course)) throw new HttpError(404,'WEEK_NOT_FOUND','강의 주차를 찾을 수 없습니다.');
  };
  const resource=(table:'materials'|'drafts'|'quizzes'|'jobs',id:string)=> {
    const row=store.get<Row>(`SELECT * FROM ${table} WHERE id=?`,id);
    if(!row) throw new HttpError(404,'NOT_FOUND','항목을 찾을 수 없습니다.');return row;
  };
  const putJob=(course:string,job:Job)=>store.run('INSERT OR REPLACE INTO jobs VALUES (?,?,?)',job.job_id,course,JSON.stringify(job));
  const queue=(course:string,job:Job,work:()=>Promise<Job['result']>,failure?:()=>void)=> {
    const promise=(async()=> {
      // 202 응답과 상태 등록을 먼저 마친다.
      await new Promise<void>(resolve=>setImmediate(resolve));
      try {putJob(course,{...job,status:'processing'});const result=await work();putJob(course,{...job,status:'completed',result})}
      catch(error) {
        const known=error instanceof HttpError?error:new HttpError(500,'JOB_FAILED','작업 처리에 실패했습니다. 다시 시도해 주세요.',true);
        putJob(course,{...job,status:'failed',error:{code:known.code,message:known.message,retryable:known.retryable}});failure?.();
      }
    })();active.add(promise);void promise.finally(()=>active.delete(promise));
  };
  const idempotent=(req:Request,res:Response,work:()=>{status:number;body:unknown})=> {
    const key=z.string().min(1).max(128).parse(req.header('Idempotency-Key'));
    const user=current(req).user_id;const route=req.method+' '+req.path;const fingerprint=hash(JSON.stringify(req.body));
    const old=store.get<{fingerprint:string;status:number;response:string}>('SELECT * FROM idempotency WHERE user_id=? AND route=? AND key=?',user,route,key);
    if(old) {
      if(old.fingerprint!==fingerprint) throw new HttpError(409,'IDEMPOTENCY_CONFLICT','같은 요청 키를 다른 내용에 사용할 수 없습니다.');
      res.status(old.status).json(JSON.parse(old.response));return;
    }
    const result=store.transaction(()=> {
      const response=work();
      store.run('INSERT INTO idempotency VALUES (?,?,?,?,?,?)',user,route,key,fingerprint,response.status,JSON.stringify(response.body));return response;
    });
    res.status(result.status).json(result.body);
  };
  app.get('/api/me',(req,res)=>res.json(current(req)));
  app.post('/api/logout',(req,res)=> {
    const token=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('campus_session='))?.slice(15);
    if(token) store.run('DELETE FROM sessions WHERE token_hash=?',hash(token));
    res.clearCookie('campus_session',{path:'/'}).sendStatus(204);
  });
  app.get('/api/courses',(req,res)=>res.json(store.all<Course>('SELECT c.id AS course_id,c.title,m.role FROM courses c JOIN memberships m ON m.course_id=c.id WHERE m.user_id=?',current(req).user_id)));
  app.get('/api/courses/:course_id/weeks',(req,res)=> {membership(req,field(req.params.course_id));res.json(store.all<Week>('SELECT id AS week_id,course_id,week_no,title FROM weeks WHERE course_id=? ORDER BY week_no',field(req.params.course_id)))});
  app.get('/api/courses/:course_id/weeks/:week_id/content',(req,res)=> {
    const course=field(req.params.course_id),week=field(req.params.week_id);weekFor(req,course,week);
    const role=membership(req,course);
    const materials=store.all<Row>('SELECT * FROM materials WHERE course_id=? AND week_id=? ORDER BY rowid DESC',course,week).map(r=>parse<Material>(r)).filter(m=>role==='professor'||m.original_visible_to_students).map(m=>{if(isDocument(m)){const {slides:_slides,file_path:_path,...view}=m;return {...view,source_type:'document' as const}}const {slides:_slides,segments:_segments,file_path:_path,...view}=m;return view});
    const drafts=role==='professor'?store.all<Row>('SELECT * FROM drafts WHERE course_id=? AND week_id=? ORDER BY rowid DESC',course,week).map(readDraft):[];
    const quizzes=store.all<Row>('SELECT * FROM quizzes WHERE course_id=? AND week_id=? ORDER BY rowid DESC',course,week).map(r=>{const q=parse<PublicQuiz>(r);return {quiz_id:q.quiz_id,draft_id:r.draft_id!,week_id:q.week_id,question_count:q.questions.length}});
    res.json({materials,drafts,quizzes} satisfies WeekContent);
  });
  app.post('/api/courses/:course_id/weeks/:week_id/materials',(req,_res,next)=> {weekFor(req,field(req.params.course_id),field(req.params.week_id),'professor');next()},upload.single('file'),(req,res)=> {
    const course=field(req.params.course_id),week=field(req.params.week_id);
    if(!req.file) throw new HttpError(422,'PPTX_REQUIRED','20MB 이하의 PDF/PPTX 파일을 선택해 주세요. 구형 PPT는 PPTX로 저장한 뒤 올려 주세요.');
    if(req.body.source_type!=='document') throw new HttpError(422,'UNSUPPORTED_SOURCE','현재 첫 기능은 PDF/PPTX 텍스트 자료를 지원합니다.');
    const start=z.coerce.number().int().min(1).max(500).parse(req.body.slide_start);
    const end=z.coerce.number().int().min(start).max(500).parse(req.body.slide_end);
    if(!['true','false'].includes(req.body.original_visible_to_students)) throw new HttpError(422,'INVALID_VISIBILITY','원본 공개 여부를 선택해 주세요.');
    const id=randomUUID(),jobId=randomUUID();const dir=resolve(options.dataDir,'materials');mkdirSync(dir,{recursive:true});
    const filePath=resolve(dir,id+extname(req.file.originalname).toLowerCase());writeFileSync(filePath,req.file.buffer,{mode:0o600});
    const original=Buffer.from(req.file.originalname,'latin1').toString('utf8');
    const material:Material={material_id:id,course_id:course,week_id:week,name:original.includes('\uFFFD')?req.file.originalname:original,slide_start:start,slide_end:end,original_visible_to_students:req.body.original_visible_to_students==='true',status:'queued',total_slides:null,slides:[],file_path:filePath};
    store.run('INSERT INTO materials VALUES (?,?,?,?)',id,course,week,JSON.stringify(material));
    const job:Job={job_id:jobId,status:'queued',result:null,error:null};putJob(course,job);
    queue(course,job,async()=> {
      const extracted=await extractDocument(filePath,start,end,options.root);
      store.run('UPDATE materials SET data=? WHERE id=?',JSON.stringify({...material,status:'completed',total_slides:extracted.total_slides,slides:extracted.slides}),id);
      return {material_id:id};
    },()=> {store.run('UPDATE materials SET data=? WHERE id=?',JSON.stringify({...material,status:'failed'}),id);try{unlinkSync(filePath)}catch{}});
    res.status(202).json({material_id:id,job_id:jobId,status:'queued'});
  });
  app.get('/api/materials/:material_id/original',(req,res)=> {
    const row=resource('materials',field(req.params.material_id)),m=parse<Material>(row);
    const role=membership(req,row.course_id);
    if(role!=='professor' && !m.original_visible_to_students) throw new HttpError(403,'PRIVATE_MATERIAL','교수님이 비공개로 설정한 자료입니다.');
    if(m.status==='completed'&&!isDocument(m)&&m.youtube){res.redirect(302,`https://www.youtube.com/watch?v=${m.youtube.video_id}&t=${m.youtube.start_sec}s`);return}
    if(m.status!=='completed' || !existsSync(m.file_path)) throw new HttpError(404,'NOT_FOUND','원본을 내려받을 수 없습니다.');
    res.download(m.file_path,m.name);
  });
  app.get('/api/jobs/:job_id',(req,res)=> {const row=resource('jobs',field(req.params.job_id));membership(req,row.course_id,'professor');res.json(parse<Job>(row))});
  app.post('/api/courses/:course_id/weeks/:week_id/quiz-drafts',(req,res)=> {
    const course=field(req.params.course_id),week=field(req.params.week_id);weekFor(req,course,week,'professor');
    const body=generationRequest.parse(req.body);
    const materials=body.material_ids.map(id=> {
      const row=resource('materials',id);membership(req,row.course_id,'professor');
      const material=parse<Material>(row);
      if(row.course_id!==course || row.week_id!==week) throw new HttpError(422,'WRONG_WEEK','현재 주차의 자료만 사용할 수 있습니다.');
      if(!isDocument(material)&&!material.youtube)throw new HttpError(422,'DOCUMENT_OR_YOUTUBE_REQUIRED','퀴즈는 PDF/PPTX 또는 등록한 YouTube 강의를 선택해 주세요.');
      if(material.status!=='completed') throw new HttpError(409,'MATERIAL_NOT_READY','자료 처리 완료 후 문제를 생성해 주세요.');return material;
    });
    if(!isDocument(materials[0])&&!options.transcriptGenerator&&!['claude','codex'].includes(provider))throw new HttpError(503,'YOUTUBE_QUIZ_PROVIDER_UNSUPPORTED','YouTube 퀴즈 생성은 Claude 또는 Codex 제공자로 설정해 주세요.');
    if(isDocument(materials[0])?!ready:!options.transcriptGenerator&&!ready) throw new HttpError(503,'AI_NOT_CONFIGURED',provider==='claude'?'Claude API 키가 설정되지 않았습니다. 서버 .env의 ANTHROPIC_API_KEY를 설정해 주세요.':provider==='codex'?'Codex 로그인을 확인해 주세요. 터미널에서 codex login으로 연결할 수 있습니다.':provider==='openai'?'문제 생성용 GPT API 키가 설정되지 않았습니다. 서버 .env의 OPENAI_API_KEY를 설정해 주세요.':'문제 생성용 Gemini API 키가 설정되지 않았습니다. 서버 .env의 GEMINI_API_KEY를 설정해 주세요.');
    // 첫 범위는 자료 1개로 제한한다. 여러 PPT의 중복 페이지 번호 혼동을 막는다.
    if(materials.length!==1) throw new HttpError(422,'ONE_MATERIAL_REQUIRED','현재는 문서 또는 YouTube 강의 한 개씩 문제를 생성할 수 있습니다.');
    idempotent(req,res,()=> {
      if(store.get<{count:number}>("SELECT COUNT(*) AS count FROM jobs WHERE course_id=? AND json_extract(data,'$.status') IN ('queued','processing')",course)!.count>0) throw new HttpError(409,'JOB_IN_PROGRESS','이 강의의 진행 중인 작업을 마친 뒤 다시 생성해 주세요.');
      const job:Job={job_id:randomUUID(),status:'queued',result:null,error:null};putJob(course,job);
      const material=materials[0];
      queue(course,job,async()=> {
        const questions=await (async()=> {
          if(!isDocument(material))return generateYouTubeQuestions(material,body.question_count,generateTranscript);
          const generated=await generateAcrossRange(material.slides,body.question_count,generate),chunkIds=new Map(material.slides.map(s=>[s.slide_no,randomUUID()]));
          return generated.map(q=>({...q,sources:[...new Set(q.slide_nos)].map(slide_no=>({material_id:material.material_id,chunk_id:chunkIds.get(slide_no)!,source_type:'document' as const,slide_no,start_sec:null,end_sec:null}))}));
        })();
        const draft:QuizDraft={draft_id:randomUUID(),week_id:week,version:1,questions:questions.map(q=>({question_id:randomUUID(),prompt:q.prompt,options:q.options.map((text,i)=>({option_id:String.fromCharCode(97+i),text})),correct_option_id:String.fromCharCode(97+q.correct_index),explanation:q.explanation,sources:q.sources}))};
        store.run('INSERT INTO drafts VALUES (?,?,?,?)',draft.draft_id,course,week,JSON.stringify(draft));return {draft_id:draft.draft_id};
      });return {status:202,body:job};
    });
  });
  app.get('/api/quiz-drafts/:draft_id',(req,res)=> {const row=resource('drafts',field(req.params.draft_id));membership(req,row.course_id,'professor');res.json(readDraft(row))});
  app.patch('/api/quiz-drafts/:draft_id/questions/:question_id',(req,res)=> {
    const row=resource('drafts',uuid.parse(req.params.draft_id));membership(req,row.course_id,'professor');const id=uuid.parse(req.params.question_id),body=editQuestionRequest.parse(req.body);
    idempotent(req,res,()=> {
      if(store.get('SELECT id FROM quizzes WHERE draft_id=?',row.id))throw new HttpError(409,'ALREADY_PUBLISHED','게시한 초안은 수정할 수 없습니다. 새 초안을 만들어 주세요.');
      const draft=readDraft(resource('drafts',row.id));
      if(draft.version!==body.expected_version)throw new HttpError(409,'DRAFT_VERSION_CONFLICT','다른 화면에서 초안이 변경되었습니다. 최신 초안을 확인한 뒤 다시 수정해 주세요.');
      const question=draft.questions.find(q=>q.question_id===id);if(!question)throw new HttpError(404,'QUESTION_NOT_FOUND','이 초안의 문항을 찾을 수 없습니다.');
      const optionIds=new Set(question.options.map(o=>o.option_id));
      if(new Set(body.options.map(o=>o.option_id)).size!==4||body.options.some(o=>!optionIds.has(o.option_id))||!optionIds.has(body.correct_option_id))throw new HttpError(422,'INVALID_OPTIONS','기존 보기 네 개와 올바른 정답을 선택해 주세요.');
      const texts=body.options.map(o=>o.text.normalize('NFKC').replace(/\s+/g,' ').toLocaleLowerCase());
      if(new Set(texts).size!==4)throw new HttpError(422,'DUPLICATE_OPTIONS','보기 내용이 서로 겹치지 않도록 수정해 주세요.');
      const textById=new Map(body.options.map(o=>[o.option_id,o.text]));
      draft.questions=draft.questions.map(q=>q.question_id===id?{...q,prompt:body.prompt,options:q.options.map(o=>({...o,text:textById.get(o.option_id)!})),correct_option_id:body.correct_option_id,explanation:body.explanation}:q);draft.version++;
      store.run('UPDATE drafts SET data=? WHERE id=?',JSON.stringify(draft),row.id);return {status:200,body:draft};
    });
  });
  app.post('/api/quiz-drafts/:draft_id/publish',(req,res)=> {
    const row=resource('drafts',field(req.params.draft_id));membership(req,row.course_id,'professor');
    const body=publishRequest.parse(req.body);
    if(new Set(body.question_ids).size!==body.question_ids.length) throw new HttpError(422,'DUPLICATE_QUESTION_ID','같은 문항을 중복 선택할 수 없습니다.');
    idempotent(req,res,()=> {
      if(store.get('SELECT id FROM quizzes WHERE draft_id=?',row.id)) throw new HttpError(409,'ALREADY_PUBLISHED','이미 게시한 초안입니다. 새 초안을 생성해 주세요.');
      const draft=readDraft(resource('drafts',row.id));
      if(draft.version!==body.expected_version)throw new HttpError(409,'DRAFT_VERSION_CONFLICT','다른 화면에서 초안이 변경되었습니다. 최신 초안을 검토한 뒤 게시해 주세요.');
      const selected=new Set(body.question_ids),questions=draft.questions.filter(q=>selected.has(q.question_id));
      if(questions.length!==selected.size) throw new HttpError(422,'UNKNOWN_QUESTION','초안에 없는 문항이 포함되어 있습니다.');
      const quiz={quiz_id:randomUUID(),week_id:row.week_id,questions};
      store.run('INSERT INTO quizzes VALUES (?,?,?,?,?)',quiz.quiz_id,row.id,row.course_id,row.week_id,JSON.stringify(quiz));
      return {status:201,body:{quiz_id:quiz.quiz_id,week_id:quiz.week_id}};
    });
  });
  app.get('/api/quizzes/:quiz_id',(req,res)=> {
    const row=resource('quizzes',field(req.params.quiz_id));membership(req,row.course_id);
    const quiz=parse<{quiz_id:string;week_id:string;questions:DraftQuestion[]}>(row);
    res.json({quiz_id:quiz.quiz_id,week_id:quiz.week_id,questions:quiz.questions.map(({question_id,prompt,options})=>({question_id,prompt,options}))} satisfies PublicQuiz);
  });
  app.post('/api/quizzes/:quiz_id/attempts',(req,res)=> {
    const row=resource('quizzes',field(req.params.quiz_id));membership(req,row.course_id,'student');
    const body=attemptRequest.parse(req.body);const quiz=parse<{questions:DraftQuestion[]}>(row);
    const answers=new Map(body.answers.map(a=>[a.question_id,a.option_id]));
    if(answers.size!==body.answers.length || answers.size!==quiz.questions.length || quiz.questions.some(q=>!q.options.some(o=>o.option_id===answers.get(q.question_id)))) throw new HttpError(422,'INVALID_ANSWERS','게시된 모든 문제에 올바른 보기를 하나씩 선택해 주세요.');
    idempotent(req,res,()=> {
      if(store.get('SELECT id FROM attempts WHERE user_id=? AND quiz_id=?',current(req).user_id,row.id)) throw new HttpError(409,'ALREADY_SUBMITTED','이미 제출한 퀴즈입니다. 내 오답에서 결과를 확인해 주세요.');
      const wrong=quiz.questions.filter(q=>answers.get(q.question_id)!==q.correct_option_id).map(q=>({...q,selected_option_id:answers.get(q.question_id)!}));
      const result:AttemptResult={attempt_id:randomUUID(),quiz_id:row.id,correct_count:quiz.questions.length-wrong.length,total_count:quiz.questions.length,wrong_questions:wrong};
      store.run('INSERT INTO attempts VALUES (?,?,?,?)',result.attempt_id,current(req).user_id,row.id,JSON.stringify(result));return {status:201,body:result};
    });
  });
  app.get('/api/me/attempts',(req,res)=>res.json(store.all<Row>('SELECT * FROM attempts WHERE user_id=? ORDER BY rowid DESC',current(req).user_id).map(r=>parse<AttemptResult>(r))));
  mountQA(app,qa,{current,membership,weekFor,idempotent});
  mountReports(app,store,{root:options.root,membership,viewThread:thread=>qa.public(thread)});
  const media=mountMedia(app,store,options.root,options.dataDir,{membership,weekFor},options.transcriber,options.youtubeImporter);
  app.use('/api',(_req,_res,next)=>next(new HttpError(404,'NOT_FOUND','API 경로를 찾을 수 없습니다.')));
  if(options.frontendDir && existsSync(resolve(options.frontendDir,'index.html'))) app.use(express.static(options.frontendDir));
  app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=> {
    if(error instanceof HttpError) {res.status(error.status).json({code:error.code,message:error.message,retryable:error.retryable});return}
    if(error instanceof z.ZodError) {res.status(422).json({code:'VALIDATION_ERROR',message:'입력 값과 요청 형식을 확인해 주세요.',retryable:false});return}
    if(error instanceof multer.MulterError) {res.status(413).json({code:'UPLOAD_LIMIT',message:'PDF/PPTX 파일은 한 번에 하나, 20MB 이하로 올려 주세요.',retryable:false});return}
    res.status(500).json({code:'INTERNAL_ERROR',message:'서버에서 요청을 처리하지 못했습니다.',retryable:false});
  });
  return {app,store,waitForJobs:async()=>{await Promise.all([...active]);await qa.waitForJobs();await media.waitForJobs()},close:async()=>{await Promise.all([...active]);await qa.waitForJobs();await media.waitForJobs();store.db.close()}};
}
