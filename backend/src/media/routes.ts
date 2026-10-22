import type {Express,Request} from 'express';
import multer from 'multer';
import {randomUUID} from 'node:crypto';
import {mkdirSync,chmodSync,unlinkSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {z} from 'zod';
import type {Store} from '../store.js';
import type {Role} from '../types.js';
import {HttpError} from '../errors.js';
import {MediaService} from './service.js';
import {createTranscriber,type Transcriber} from './transcribe.js';
import {createYouTubeImporter,type YouTubeImporter} from './youtube.js';
import {parseYouTubeUrl} from './youtube-url.js';
interface Context {membership:(req:Request,course:string,role?:Role)=>Role;weekFor:(req:Request,course:string,week:string,role?:Role)=>void}
const audio=new Set(['.mp3','.m4a','.wav','.ogg','.flac']),video=new Set(['.mp4','.mov','.webm','.mkv']);
export function mountMedia(app:Express,store:Store,root:string,dataDir:string,context:Context,transcriber?:Transcriber,youtubeImporter?:YouTubeImporter) {
 const service=new MediaService(store,transcriber || createTranscriber(root,dataDir),youtubeImporter||createYouTubeImporter(root,dataDir));
 app.post('/api/courses/:course_id/weeks/:week_id/youtube',(req,res)=> {
  const course=z.string().uuid().parse(req.params.course_id),week=z.string().uuid().parse(req.params.week_id);context.weekFor(req,course,week,'professor');
  const body=z.object({url:z.string().min(1).max(2048),start_sec:z.number().int().min(0).max(7199).optional(),end_sec:z.number().int().min(1).max(7200).nullable().optional(),original_visible_to_students:z.boolean()}).strict().parse(req.body);
  let link;try{link=parseYouTubeUrl(body.url)}catch(error){throw new HttpError(422,'INVALID_YOUTUBE_URL',error instanceof Error?error.message:'YouTube 링크를 확인해 주세요.')}
  const start=body.start_sec??link.start_sec,end=body.end_sec??null;if(end!==null&&end<=start)throw new HttpError(422,'YOUTUBE_RANGE_INVALID','끝 시간은 시작 시간보다 커야 합니다.');
  res.status(202).json(service.add({course_id:course,week_id:week,name:`YouTube · ${link.video_id}`,source_type:'video',original_visible_to_students:body.original_visible_to_students,file_path:'',youtube:{...link,start_sec:start,end_sec:end,method:null,is_generated:null}}));
 });
 const dir=resolve(dataDir,'media');mkdirSync(dir,{recursive:true,mode:0o700});
 const files=new WeakMap<Request,string>();
 const upload=multer({storage:multer.diskStorage({destination:dir,filename:(req,file,cb)=>{const name=randomUUID()+extname(file.originalname).toLowerCase();files.set(req,resolve(dir,name));cb(null,name)}}),limits:{fileSize:500*1024*1024,files:1,fields:2,parts:3},fileFilter:(_req,file,cb)=>cb(null,audio.has(extname(file.originalname).toLowerCase())||video.has(extname(file.originalname).toLowerCase()))}).single('file');
 app.post('/api/courses/:course_id/weeks/:week_id/media',(req,res,next)=> {
  try {context.weekFor(req,z.string().uuid().parse(req.params.course_id),z.string().uuid().parse(req.params.week_id),'professor');service.capacity()}catch(e){next(e);return}
  let accepted=false;const cleanup=()=>{if(!accepted){const path=files.get(req);if(path)try{unlinkSync(path)}catch{}}};
  req.once('aborted',cleanup);
  upload(req,res,error=> {
   if(error){cleanup();next(error instanceof multer.MulterError?new HttpError(413,'MEDIA_UPLOAD_LIMIT','녹음·동영상은 한 개씩, 500MB 이하로 올려 주세요.'):error);return}
   try {
    if(!req.file)throw new HttpError(422,'MEDIA_REQUIRED','지원하는 녹음·동영상 파일을 선택해 주세요.');
    chmodSync(req.file.path,0o600);
    const body=z.object({source_type:z.enum(['audio','video']),original_visible_to_students:z.enum(['true','false'])}).strict().parse(req.body);
    const extension=extname(req.file.originalname).toLowerCase();
    if((body.source_type==='audio'&&!audio.has(extension))||(body.source_type==='video'&&!video.has(extension)))throw new HttpError(422,'INVALID_MEDIA_TYPE','선택한 파일과 자료 종류가 일치하지 않습니다.');
    const original=Buffer.from(req.file.originalname,'latin1').toString('utf8');
    const receipt=service.add({course_id:String(req.params.course_id),week_id:String(req.params.week_id),name:(original.includes('\uFFFD')?req.file.originalname:original).slice(0,180),file_path:req.file.path,source_type:body.source_type,original_visible_to_students:body.original_visible_to_students==='true'});
    accepted=true;res.status(202).json(receipt);
   }catch(e){cleanup();next(e)}
  });
 });
 const authorize=(req:Request)=>{const m=service.get(z.string().uuid().parse(req.params.material_id)),role=context.membership(req,m.course_id);if(role!=='professor'&&!m.original_visible_to_students)throw new HttpError(403,'PRIVATE_MATERIAL','교수님이 비공개로 설정한 원본·전사입니다.');return m};
 app.get('/api/materials/:material_id/transcript',(req,res)=>{const m=authorize(req);res.json({material_id:m.material_id,status:m.status,duration_sec:m.duration_sec,language:m.language,segments:m.segments,error:m.error})});
 app.get('/api/materials/:material_id/playback',(req,res)=>{const m=authorize(req);if(m.status!=='completed')throw new HttpError(404,'MEDIA_NOT_READY','재생할 수 있는 원본이 없습니다.');if(m.youtube){const end=m.youtube.end_sec??m.duration_sec!;const start=req.query.start===undefined?m.youtube.start_sec:z.coerce.number().finite().min(m.youtube.start_sec).max(end).parse(req.query.start);res.redirect(302,`https://www.youtube.com/watch?v=${m.youtube.video_id}&t=${Math.floor(start)}s`);return}if(!existsSync(m.file_path))throw new HttpError(404,'MEDIA_NOT_READY','재생할 수 있는 원본이 없습니다.');res.sendFile(m.file_path)});
 app.post('/api/materials/:material_id/transcription-retry',(req,res)=>{const m=service.get(z.string().uuid().parse(req.params.material_id));context.membership(req,m.course_id,'professor');z.object({}).strict().parse(req.body);res.status(202).json(service.retry(m))});
 return service;
}
