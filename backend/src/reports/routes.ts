import type {Express,Request} from 'express';
import {z} from 'zod';
import {HttpError} from '../errors.js';
import type {Store} from '../store.js';
import type {Role,Week} from '../types.js';
import type {QAThread,StoredThread} from '../qa/types.js';
import {Reports} from './service.js';
interface Context {membership:(req:Request,course:string,role?:Role)=>Role;viewThread:(thread:StoredThread)=>QAThread}
const selection=z.string().trim().min(1).transform(value=>value.split(',').map(s=>s.trim())).pipe(z.array(z.string().uuid()).min(1).max(100));
const query=z.object({week_ids:selection.optional()}).strict();
const qaQuery=z.object({week_ids:selection.optional(),page:z.coerce.number().int().min(1).max(100000).default(1),page_size:z.coerce.number().int().min(1).max(100).default(25)}).strict();
export function mountReports(app:Express,store:Store,context:Context) {
 const service=new Reports(store,context.viewThread);
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
}
