import {workerEnvironment} from '../worker-env.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {z} from 'zod';
import {HttpError} from '../errors.js';
const exec=promisify(execFile);
const segment=z.object({start_sec:z.number().finite().min(0),end_sec:z.number().finite().positive(),text:z.string().trim().min(1).max(6000)}).strict();
export const transcriptionSchema=z.object({duration_sec:z.number().finite().positive().max(7200.1),language:z.string().min(2).max(32),segments:z.array(segment).min(1).max(5000)}).strict().superRefine((value,ctx)=> {
 let previous=0,total=0;
 for(const item of value.segments) {
  if(item.end_sec<=item.start_sec || item.end_sec>value.duration_sec+.001 || item.start_sec<previous)ctx.addIssue({code:'custom',message:'Invalid transcript timestamps'});
  previous=item.start_sec;total+=item.text.length;
 }
 if(total>600000)ctx.addIssue({code:'custom',message:'Transcript too large'});
});
export type Transcription=z.infer<typeof transcriptionSchema>;
export type Transcriber=(file:string,sourceType:'audio'|'video')=>Promise<Transcription>;
const safeError=z.object({code:z.enum(['MEDIA_NOT_CONFIGURED','INVALID_MEDIA','NO_AUDIO','MEDIA_TOO_LONG','AUDIO_DECODE_FAILED','INVALID_TRANSCRIPT','TRANSCRIPT_TOO_LARGE','NO_SPEECH','TRANSCRIPTION_MODEL_FAILED','TRANSCRIPTION_FAILED']),error:z.string().max(250)});
export function createTranscriber(root:string,dataDir:string):Transcriber {
 return async(file,sourceType)=> {
  const env={...workerEnvironment(),HF_HUB_DISABLE_TELEMETRY:'1',HF_HUB_DISABLE_PROGRESS_BARS:'1',HF_HUB_DISABLE_XET:'1'};
  try {
   const {stdout}=await exec(process.env.PYTHON_BIN || 'python3',[resolve(root,'worker/transcribe_media.py'),file,'--source-type',sourceType,'--model',process.env.WHISPER_MODEL || 'small','--language',process.env.WHISPER_LANGUAGE || 'auto','--cache-dir',process.env.WHISPER_CACHE_DIR?resolve(root,process.env.WHISPER_CACHE_DIR):resolve(dataDir,'models'),'--ffmpeg',process.env.FFMPEG_BIN || 'ffmpeg','--ffprobe',process.env.FFPROBE_BIN || 'ffprobe'],{timeout:3600000,maxBuffer:8*1024*1024,killSignal:'SIGKILL',env});
   const parsed=transcriptionSchema.safeParse(JSON.parse(stdout));
   if(!parsed.success)throw new HttpError(502,'INVALID_TRANSCRIPT','전사 결과의 시간·텍스트 형식을 확인하지 못했습니다.',true);
   return parsed.data;
  }catch(error) {
   if(error instanceof HttpError)throw error;
   if(error&&typeof error==='object'&&'stdout' in error) {
    try {
     const parsed=safeError.safeParse(JSON.parse(String(error.stdout)));
     if(parsed.success) {
      const code=parsed.data.code,retryable=['MEDIA_NOT_CONFIGURED','TRANSCRIPTION_MODEL_FAILED','TRANSCRIPTION_FAILED','INVALID_TRANSCRIPT'].includes(code);
      throw new HttpError(code==='MEDIA_NOT_CONFIGURED'?503:422,code,parsed.data.error,retryable);
     }
    }catch(known){if(known instanceof HttpError)throw known}
   }
   throw new HttpError(502,'TRANSCRIPTION_FAILED','전사를 완료하지 못했습니다. 전사 환경·파일을 확인한 뒤 다시 시도해 주세요.',true);
  }
 };
}
