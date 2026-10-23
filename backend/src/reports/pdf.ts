import {workerEnvironment} from '../worker-env.js';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {HttpError} from '../errors.js';
import type {QAReport,QuizReport,StudentWrongReport} from './types.js';
export interface ReportSnapshot {course_title:string;generated_at:string;quiz:QuizReport;qa:QAReport}
export interface StudentReportSnapshot {report_type:'student_wrong_answers';course_title:string;generated_at:string;report:StudentWrongReport}
/** Pass an authorized snapshot over stdin, without files, shell evaluation or API keys. */
export function renderReportPDF(snapshot:ReportSnapshot|StudentReportSnapshot,root:string):Promise<Buffer> {
 const input=JSON.stringify(snapshot);
 if(Buffer.byteLength(input)>16*1024*1024)throw new HttpError(422,'REPORT_TOO_LARGE','레포트가 너무 큽니다. 주차를 나누어 다운로드해 주세요.');
 return new Promise((resolvePDF,reject)=> {
  const env=workerEnvironment();
  const start=()=>spawn(process.env.PYTHON_BIN||'python3',[resolve(root,'worker/report_pdf.py')],{env,stdio:['pipe','pipe','ignore']});
  let child:ReturnType<typeof start>;
  try{child=start()}catch{reject(new HttpError(503,'REPORT_PDF_UNAVAILABLE','PDF 생성 환경을 확인해 주세요. Python과 worker/requirements.txt 설치가 필요합니다.',true));return}
  const chunks:Buffer[]=[];let size=0,settled=false;
  const fail=(code:string,message:string,status=503)=>{if(settled)return;settled=true;clearTimeout(timer);child.kill('SIGKILL');reject(new HttpError(status,code,message,true))};
  const timer=setTimeout(()=>fail('REPORT_TIMEOUT','PDF 생성 시간이 길어지고 있습니다. 주차를 나누어 다시 시도해 주세요.'),30000);
  child.on('error',()=>fail('REPORT_PDF_UNAVAILABLE','PDF 생성 환경을 확인해 주세요. Python과 worker/requirements.txt 설치가 필요합니다.'));
  child.stdin.on('error',()=>fail('REPORT_PDF_UNAVAILABLE','PDF를 생성하지 못했습니다. Python과 worker/requirements.txt 설치를 확인해 주세요.'));
  child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>32*1024*1024)fail('REPORT_TOO_LARGE','PDF가 너무 큽니다. 주차를 나누어 다시 시도해 주세요.',422);else chunks.push(chunk)});
  child.on('close',code=>{if(settled)return;const pdf=Buffer.concat(chunks);if(code!==0||!pdf.subarray(0,5).equals(Buffer.from('%PDF-')))return fail('REPORT_PDF_UNAVAILABLE','PDF를 생성하지 못했습니다. Python과 worker/requirements.txt 설치를 확인해 주세요.');settled=true;clearTimeout(timer);resolvePDF(pdf)});
  child.stdin.end(input);
 });
}
