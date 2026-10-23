import {randomBytes,randomUUID} from 'node:crypto';
import type {Express,Request} from 'express';
import {z} from 'zod';
import type {Database} from '../database.js';
import type {Role,User} from '../types.js';
import {HttpError} from '../errors.js';
import {consumeInvite,tokenHash} from '../auth/routes.js';
interface Context {current:(req:Request)=>User;membership:(req:Request,course:string,role?:Role)=>Promise<Role>}
export function mountCourses(app:Express,store:Database,context:Context) {
  app.post('/api/courses/join',async(req,res)=> {
    const body=z.object({invite_code:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict().parse(req.body);
    const invite=await store.transaction(()=>consumeInvite(store,body.invite_code,context.current(req).user_id));
    const course=await store.get<{title:string}>('SELECT title FROM courses WHERE id=?',invite.course_id);
    res.status(201).json({course_id:invite.course_id,title:course!.title,role:invite.role});
  });
  app.post('/api/courses',async(req,res)=> {
    const user=context.current(req).user_id;
    if(!await store.get("SELECT course_id FROM memberships WHERE user_id=? AND role='professor'",user))throw new HttpError(403,'PROFESSOR_REQUIRED','강의 생성은 교수 계정에서만 가능합니다.');
    const body=z.object({title:z.string().trim().min(1).max(200),week_count:z.number().int().min(1).max(52).default(15)}).strict().parse(req.body);
    const course=randomUUID();await store.transaction(async()=> {
      await store.run('INSERT INTO courses VALUES (?,?)',course,body.title);await store.run('INSERT INTO memberships VALUES (?,?,?)',user,course,'professor');
      for(let n=1;n<=body.week_count;n++)await store.run('INSERT INTO weeks VALUES (?,?,?,?)',randomUUID(),course,n,`${n}주차 학습`);
    });res.status(201).json({course_id:course,title:body.title,role:'professor'});
  });
  app.post('/api/courses/:course_id/invites',async(req,res)=> {
    const course=z.string().uuid().parse(req.params.course_id);await context.membership(req,course,'professor');
    const body=z.object({role:z.enum(['professor','student'])}).strict().parse(req.body),code=randomBytes(32).toString('base64url'),expires=Date.now()+7*86400000;
    await store.run('INSERT INTO course_invites VALUES (?,?,?,?,?)',tokenHash(code),course,body.role,expires,null);
    res.status(201).json({invite_code:code,role:body.role,expires_at:new Date(expires).toISOString()});
  });
  app.get('/api/courses/:course_id/members',async(req,res)=> {
    const course=z.string().uuid().parse(req.params.course_id);await context.membership(req,course,'professor');
    res.json(await store.all('SELECT u.id AS user_id,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.course_id=? ORDER BY m.role,u.name',course));
  });
}
