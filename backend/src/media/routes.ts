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
interface Context {membership:(req:Request,course:string,role?:Role)=>Role;weekFor:(req:Request,course:string,week:string,role?:Role)=>void}
const audio=new Set(['.mp3','.m4a','.wav','.ogg','.flac']),video=new Set(['.mp4','.mov','.webm','.mkv']);
export function mountMedia(app:Express,store:Store,root:string,dataDir:string,context:Context,transcriber?:Transcriber) {
 const service=new MediaService(store,transcriber || createTranscriber(root,dataDir));
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
 app.get('/api/materials/:material_id/playback',(req,res)=>{const m=authorize(req);if(m.status!=='completed'||!existsSync(m.file_path))throw new HttpError(404,'MEDIA_NOT_READY','재생할 수 있는 원본이 없습니다.');res.sendFile(m.file_path)});
 app.post('/api/materials/:material_id/transcription-retry',(req,res)=>{const m=service.get(z.string().uuid().parse(req.params.material_id));context.membership(req,m.course_id,'professor');z.object({}).strict().parse(req.body);res.status(202).json(service.retry(m))});
 return service;
}
