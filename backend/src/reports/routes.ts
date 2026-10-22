import type {Express,Request} from 'express';
import {z} from 'zod';
import {HttpError} from '../errors.js';
import type {Store} from '../store.js';
import type {Role,Week,User} from '../types.js';
import type {QAThread,StoredThread} from '../qa/types.js';
import {Reports} from './service.js';
import {renderReportPDF,type ReportSnapshot,type StudentReportSnapshot} from './pdf.js';
import {studentWrongReport} from './student.js';
interface Context {root:string;current:(req:Request)=>User;membership:(req:Request,course:string,role?:Role)=>Role;viewThread:(thread:StoredThread)=>QAThread}
const selection=z.string().trim().min(1).transform(value=>value.split(',').map(s=>s.trim())).pipe(z.array(z.string().uuid()).min(1).max(100));
const query=z.object({week_ids:selection.optional()}).strict();
const qaQuery=z.object({week_ids:selection.optional(),page:z.coerce.number().int().min(1).max(100000).default(1),page_size:z.coerce.number().int().min(1).max(100).default(25)}).strict();
export function mountReports(app:Express,store:Store,context:Context) {
 const service=new Reports(store,context.viewThread);
 let exporting=0;
 function selectedWeeks(course:string,ids?:string[]) {
  const all=store.all<Week>('SELECT id AS week_id,course_id,week_no,title FROM weeks WHERE course_id=? ORDER BY week_no,id',course);
  if(!ids)return all;const selected=new Set(ids);
  if([...selected].some(id=>!all.some(w=>w.week_id===id)))throw new HttpError(404,'WEEK_NOT_FOUND','선택한 주차가 이 강의에 없습니다.');
  return all.filter(w=>selected.has(w.week_id));
 }
 app.get('/api/courses/:course_id/reports/quizzes',(req,res)=> {
  const course=z.string().uuid().parse(req.params.course_id);context.membership(req,course,'professor');
  const body=query.parse(req.query);res.json(service.quizzes(course,selectedWeeks(course,body.week_ids)));
 });
 app.get('/api/courses/:course_id/reports/qa',(req,res)=> {
  const course=z.string().uuid().parse(req.params.course_id);context.membership(req,course,'professor');
  const body=qaQuery.parse(req.query);res.json(service.qa(course,selectedWeeks(course,body.week_ids),body.page,body.page_size));
 });
 app.get('/api/courses/:course_id/reports/wrong-answers',(req,res)=> {
  const course=z.string().uuid().parse(req.params.course_id);context.membership(req,course,'student');
  const body=query.parse(req.query);res.json(store.transaction(()=>studentWrongReport(store,course,selectedWeeks(course,body.week_ids),context.current(req))));
 });
 app.get('/api/courses/:course_id/reports/wrong-answers/pdf',async(req,res)=> {
  const course=z.string().uuid().parse(req.params.course_id);context.membership(req,course,'student');
  const body=query.parse(req.query),weeks=selectedWeeks(course,body.week_ids);
  if(exporting>=2)throw new HttpError(429,'REPORT_BUSY','다른 PDF를 생성하고 있습니다. 잠시 뒤 다시 시도해 주세요.',true);
  const snapshot=store.transaction<StudentReportSnapshot>(()=> {
   const report=studentWrongReport(store,course,weeks,context.current(req));
   return {report_type:'student_wrong_answers',course_title:store.get<{title:string}>('SELECT title FROM courses WHERE id=?',course)!.title,generated_at:report.generated_at,report};
  });
  exporting++;
  try {
   const pdf=await renderReportPDF(snapshot,context.root),date=new Date(Date.parse(snapshot.generated_at)+9*3600000).toISOString().slice(0,10);
   res.type('application/pdf').setHeader('Content-Disposition',`attachment; filename="campus-wrong-answers-${date}.pdf"; filename*=UTF-8''${encodeURIComponent('나의-오답-레포트-'+date+'.pdf')}`);res.send(pdf);
  }finally{exporting--}
 });
 app.get('/api/courses/:course_id/reports/pdf',async(req,res)=> {
  const course=z.string().uuid().parse(req.params.course_id);context.membership(req,course,'professor');
  const body=query.parse(req.query),weeks=selectedWeeks(course,body.week_ids);
  if(exporting>=2)throw new HttpError(429,'REPORT_BUSY','다른 PDF를 생성하고 있습니다. 잠시 뒤 다시 시도해 주세요.',true);
  const snapshot=store.transaction<ReportSnapshot>(()=> {
   const quiz=service.quizzes(course,weeks),first=service.qa(course,weeks,1,1);
   if(quiz.summary.question_count>2000||first.total_count>1000)throw new HttpError(422,'REPORT_TOO_LARGE','레포트가 너무 큽니다. 주차를 나누어 다운로드해 주세요.');
   const qa=first.total_count>1?service.qa(course,weeks,1,first.total_count):first;
   const generated_at=new Date().toISOString();quiz.generated_at=generated_at;qa.generated_at=generated_at;
   return {course_title:store.get<{title:string}>('SELECT title FROM courses WHERE id=?',course)!.title,generated_at,quiz,qa};
  });
  exporting++;
  try {
   const pdf=await renderReportPDF(snapshot,context.root),date=new Date(Date.parse(snapshot.generated_at)+9*3600000).toISOString().slice(0,10);
   res.type('application/pdf').setHeader('Content-Disposition',`attachment; filename="campus-report-${date}.pdf"; filename*=UTF-8''${encodeURIComponent('수업-레포트-'+date+'.pdf')}`);
   res.send(pdf);
  }finally{exporting--}
 });
}
