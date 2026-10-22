import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {z} from 'zod';
import type {YouTubeOrigin} from '../types.js';
import {HttpError} from '../errors.js';
import {transcriptionSchema} from './transcribe.js';
const exec=promisify(execFile);
export const youtubeResultSchema=z.object({transcription:transcriptionSchema,name:z.string().trim().min(1).max(180),method:z.enum(['captions','audio']),is_generated:z.boolean().nullable()}).strict();
export type YouTubeImporter=(input:YouTubeOrigin)=>Promise<z.infer<typeof youtubeResultSchema>>;
const safeError=z.object({code:z.enum(['YOUTUBE_NOT_CONFIGURED','YOUTUBE_UNAVAILABLE','YOUTUBE_FETCH_FAILED','YOUTUBE_TOO_LARGE','YOUTUBE_RANGE_INVALID','YOUTUBE_ACCESS_BLOCKED','MEDIA_TOO_LONG','NO_SPEECH','INVALID_TRANSCRIPT','TRANSCRIPTION_FAILED','MEDIA_NOT_CONFIGURED','TRANSCRIPTION_MODEL_FAILED','AUDIO_DECODE_FAILED','INVALID_MEDIA','TRANSCRIPT_TOO_LARGE']),error:z.string().max(250)});
export function createYouTubeImporter(root:string,dataDir:string):YouTubeImporter {
 return async input=> {
  const env={...process.env,HF_HUB_DISABLE_TELEMETRY:'1',HF_HUB_DISABLE_PROGRESS_BARS:'1',HF_HUB_DISABLE_XET:'1'};
  for(const key of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','TYPESAFE_API_KEY','CODEX_API_KEY','GEMINI_API_KEY','SUPABASE_SERVICE_ROLE_KEY'])delete env[key as keyof typeof env];
  try {
   const args=[resolve(root,'worker/import_youtube.py'),'--video-id',input.video_id,'--start',String(input.start_sec),'--model',process.env.WHISPER_MODEL||'small','--language',process.env.WHISPER_LANGUAGE||'auto','--cache-dir',process.env.WHISPER_CACHE_DIR?resolve(root,process.env.WHISPER_CACHE_DIR):resolve(dataDir,'models'),'--ffmpeg',process.env.FFMPEG_BIN||'ffmpeg','--ffprobe',process.env.FFPROBE_BIN||'ffprobe'];
   if(input.end_sec!==null)args.push('--end',String(input.end_sec));
   const {stdout}=await exec(process.env.YOUTUBE_PYTHON_BIN||process.env.PYTHON_BIN||'python3',args,{timeout:3600000,maxBuffer:8*1024*1024,killSignal:'SIGKILL',env});
   const result=youtubeResultSchema.safeParse(JSON.parse(stdout));
   if(!result.success)throw new HttpError(502,'INVALID_TRANSCRIPT','YouTube 근거의 시간·내용 형식을 확인하지 못했습니다.',true);
   return result.data;
  }catch(error) {
   if(error instanceof HttpError)throw error;
   if(error&&typeof error==='object'&&'stdout' in error)try {
    const result=safeError.safeParse(JSON.parse(String(error.stdout)));
    if(result.success)throw new HttpError(422,result.data.code,result.data.error,!['YOUTUBE_UNAVAILABLE','YOUTUBE_TOO_LARGE','YOUTUBE_RANGE_INVALID','MEDIA_TOO_LONG','NO_SPEECH'].includes(result.data.code));
   }catch(known){if(known instanceof HttpError)throw known}
   throw new HttpError(502,'YOUTUBE_FETCH_FAILED','YouTube 자료를 가져오지 못했습니다. 링크·전사 환경을 확인하거나 파일로 올려 주세요.',true);
  }
 };
}
