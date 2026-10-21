import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import type {Store} from '../store.js';
import {HttpError} from '../errors.js';
import type {Job,MediaMaterial} from '../types.js';
import {transcriptionSchema,type Transcriber} from './transcribe.js';
export class MediaService {
 private tail:Promise<void>=Promise.resolve();
 constructor(private store:Store,private transcribe:Transcriber) {
  for(const row of store.all<{data:string}>('SELECT data FROM materials')) {
   const m=JSON.parse(row.data) as MediaMaterial;
   if(['audio','video'].includes(m.source_type)&&m.status==='failed'&&!m.error) {
    m.error={code:'PROCESS_INTERRUPTED',message:'서버가 다시 시작되어 전사가 중단되었습니다. 다시 시도해 주세요.',retryable:true};this.save(m);
   }
  }
 }
 capacity() {if(this.store.get<{n:number}>("SELECT COUNT(*) AS n FROM materials WHERE json_extract(data,'$.source_type') IN ('audio','video') AND json_extract(data,'$.status') IN ('queued','processing')")!.n>=3)throw new HttpError(429,'TRANSCRIPTION_BUSY','전사 대기 작업이 많습니다. 기존 작업을 마친 뒤 다시 올려 주세요.',true)}
 private save(m:MediaMaterial) {this.store.run('UPDATE materials SET data=? WHERE id=?',JSON.stringify(m),m.material_id)}
 private job(job:Job,course:string) {this.store.run('INSERT OR REPLACE INTO jobs VALUES (?,?,?)',job.job_id,course,JSON.stringify(job))}
 get(id:string) {
  const row=this.store.get<{data:string}>('SELECT data FROM materials WHERE id=?',id);if(!row)throw new HttpError(404,'MATERIAL_NOT_FOUND','자료를 찾을 수 없습니다.');
  const m=JSON.parse(row.data) as MediaMaterial;if(!['audio','video'].includes(m.source_type))throw new HttpError(422,'NOT_MEDIA','녹음·동영상 자료만 전사할 수 있습니다.');return m;
 }
 add(input:Omit<MediaMaterial,'material_id'|'job_id'|'error'|'status'|'slides'|'segments'|'slide_start'|'slide_end'|'total_slides'|'duration_sec'|'language'>) {
  this.capacity();const m:MediaMaterial={...input,material_id:randomUUID(),job_id:randomUUID(),error:null,status:'queued',slides:[],segments:[],slide_start:null,slide_end:null,total_slides:null,duration_sec:null,language:null};
  this.store.transaction(()=>{this.store.run('INSERT INTO materials VALUES (?,?,?,?)',m.material_id,m.course_id,m.week_id,JSON.stringify(m));this.job({job_id:m.job_id,status:'queued',result:null,error:null},m.course_id)});this.schedule(m);
  return {material_id:m.material_id,job_id:m.job_id,status:'queued' as const};
 }
 retry(m:MediaMaterial) {
  if(m.status!=='failed'||!m.error?.retryable)throw new HttpError(409,'TRANSCRIPTION_RETRY_UNAVAILABLE','다시 시도할 수 있는 전사 오류가 없습니다.');
  if(!existsSync(m.file_path))throw new HttpError(404,'MEDIA_FILE_MISSING','원본이 없어 다시 전사할 수 없습니다. 파일을 다시 올려 주세요.');
  this.capacity();m.job_id=randomUUID();m.status='queued';m.error=null;this.store.transaction(()=>{this.save(m);this.job({job_id:m.job_id,status:'queued',result:null,error:null},m.course_id)});this.schedule(m);return {material_id:m.material_id,job_id:m.job_id,status:'queued' as const};
 }
 private schedule(m:MediaMaterial) {
  this.tail=this.tail.then(async()=> {
   await new Promise<void>(resolve=>setImmediate(resolve));
   m.status='processing';this.save(m);this.job({job_id:m.job_id,status:'processing',result:null,error:null},m.course_id);
   try {
    const result=transcriptionSchema.safeParse(await this.transcribe(m.file_path,m.source_type));
    if(!result.success)throw new HttpError(502,'INVALID_TRANSCRIPT','전사 결과의 시간 범위를 확인하지 못했습니다.',true);
    Object.assign(m,result.data,{status:'completed',error:null});this.save(m);this.job({job_id:m.job_id,status:'completed',result:{material_id:m.material_id},error:null},m.course_id);
   }catch(error) {
    const known=error instanceof HttpError?error:new HttpError(502,'TRANSCRIPTION_FAILED','전사를 완료하지 못했습니다. 파일과 전사 환경을 확인해 주세요.',true);
    m.status='failed';m.error={code:known.code,message:known.message,retryable:known.retryable};m.segments=[];this.save(m);this.job({job_id:m.job_id,status:'failed',result:null,error:m.error},m.course_id);
   }
  });
 }
 async waitForJobs() {await this.tail}
}
