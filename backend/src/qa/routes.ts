import type {Express,Request,Response} from 'express';
import {z} from 'zod';
import type {Role,User} from '../types.js';
import {HttpError} from '../errors.js';
import type {QAService} from './service.js';
interface Context {current:(req:Request)=>User;membership:(req:Request,course:string,role?:Role)=>Role;weekFor:(req:Request,course:string,week:string,role?:Role)=>void;idempotent:(req:Request,res:Response,fn:()=>{status:number;body:unknown})=>void}
const id=(v:unknown)=>z.string().uuid().parse(v);
const text=z.string().trim().min(1).max(4000);
const reply=z.object({text,expected_version:z.number().int().positive()}).strict();
export function mountQA(app:Express,service:QAService,context:Context) {
 const authorize=(req:Request,threadId:string)=> {
  const thread=service.get(threadId),user=context.current(req),role=context.membership(req,thread.course_id);
  if(role==='student'&&thread.student_id!==user.user_id)throw new HttpError(403,'QA_FORBIDDEN','본인의 질문만 확인할 수 있습니다.');return {thread,role};
 };
 app.get('/api/courses/:course_id/weeks/:week_id/threads',(req,res)=> {
  const course=id(req.params.course_id),week=id(req.params.week_id);context.weekFor(req,course,week);const role=context.membership(req,course);
  res.json(service.list(course,week,context.current(req).user_id,role));
 });
 app.post('/api/courses/:course_id/weeks/:week_id/threads',(req,res)=> {
  const course=id(req.params.course_id),week=id(req.params.week_id);context.weekFor(req,course,week,'student');
  const body=z.object({text}).strict().parse(req.body);context.idempotent(req,res,()=>({status:201,body:service.create(course,week,context.current(req),body.text)}));
 });
 app.get('/api/threads/:thread_id',(req,res)=> {const {thread}=authorize(req,id(req.params.thread_id));res.json(service.public(thread))});
 app.get('/api/threads/:thread_id/decisions',(req,res)=> {const {thread,role}=authorize(req,id(req.params.thread_id));if(role!=='professor')throw new HttpError(403,'QA_FORBIDDEN','판단 기록은 교수님만 확인할 수 있습니다.');res.json(thread.decisions)});
 app.post('/api/threads/:thread_id/messages',(req,res)=> {
  const threadId=id(req.params.thread_id),{role}=authorize(req,threadId),body=reply.parse(req.body);
  context.idempotent(req,res,()=>({status:role==='professor'?200:202,body:service.reply(threadId,role,body.text,body.expected_version)}));
 });
 app.post('/api/threads/:thread_id/retry',(req,res)=> {
  const threadId=id(req.params.thread_id);authorize(req,threadId);const body=z.object({expected_version:z.number().int().positive()}).strict().parse(req.body);
  context.idempotent(req,res,()=>({status:202,body:service.retry(threadId,body.expected_version)}));
 });
}
