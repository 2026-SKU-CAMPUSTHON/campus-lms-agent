import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Express,Request,Response} from 'express';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import type {Database} from '../database.js';
import {HttpError} from '../errors.js';
import type {User,Role} from '../types.js';
import {hashPassword,verifyPassword} from './password.js';
export const tokenHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const sessionCookie=(production:boolean)=>production?'__Host-campus_session':'campus_session';
export function readSession(req:Request,production:boolean){const name=sessionCookie(production);return req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)}
export async function openSession(store:Database,res:Response,user:string,production:boolean) {
  const token=randomBytes(32).toString('base64url'),maxAge=8*3600000;
  await store.run('DELETE FROM sessions WHERE expires_at < ?',Date.now());
  await store.run('INSERT INTO sessions VALUES (?,?,?)',tokenHash(token),user,Date.now()+maxAge);
  res.cookie(sessionCookie(production),token,{httpOnly:true,secure:production,sameSite:'strict',path:'/',maxAge});
}
const email=z.string().trim().email().max(254).transform(s=>s.toLowerCase());
const password=z.string().min(12).max(128).refine(s=>Buffer.byteLength(s)<=512);
const inviteCode=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export interface Invite {course_id:string;role:Role;expires_at:number;used_by:string|null}
export async function consumeInvite(store:Database,code:string,user:string) {
  const invite=await store.get<Invite>('SELECT course_id,role,expires_at,used_by FROM course_invites WHERE token_hash=?',tokenHash(code));
  if(!invite||invite.expires_at<=Date.now()||invite.used_by)throw new HttpError(422,'INVALID_INVITE','초대 코드가 만료되었거나 이미 사용되었습니다.');
  if(await store.get('SELECT role FROM memberships WHERE user_id=? AND course_id=?',user,invite.course_id))throw new HttpError(409,'ALREADY_ENROLLED','이미 참여 중인 강의입니다.');
  await store.run('INSERT INTO memberships VALUES (?,?,?)',user,invite.course_id,invite.role);
  await store.run('UPDATE course_invites SET used_by=? WHERE token_hash=?',user,tokenHash(code));
  return invite;
}
export function mountAuth(app:Express,store:Database,options:{production:boolean;demoAuth:boolean}) {
  app.get('/api/auth/config',(_req,res)=>res.json({mode:options.demoAuth?'demo':'password',registration:'invite',password_min_length:12}));
  const limit=rateLimit({windowMs:15*60000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,message:{code:'AUTH_RATE_LIMIT',message:'로그인 시도가 많습니다. 15분 뒤 다시 시도해 주세요.',retryable:true}});
  app.post('/api/auth/login',limit,async(req,res)=> {
    const body=z.object({email,password:z.string().min(1).max(128)}).strict().parse(req.body);
    const account=await store.get<User&{password_hash:string}>('SELECT u.id AS user_id,u.name,a.password_hash FROM auth_credentials a JOIN users u ON u.id=a.user_id WHERE a.email=?',body.email);
    // A fixed dummy hash keeps unknown-email attempts on the same password path.
    const valid=await verifyPassword(body.password,account?.password_hash??'scrypt-v1$00000000000000000000000000000000$'+'00'.repeat(64));
    if(!account||!valid)throw new HttpError(401,'INVALID_LOGIN','이메일 또는 비밀번호를 확인해 주세요.');
    await openSession(store,res,account.user_id,options.production);res.json({user_id:account.user_id,name:account.name});
  });
  app.post('/api/auth/register',limit,async(req,res)=> {
    const body=z.object({email,password,name:z.string().trim().min(1).max(120),invite_code:inviteCode}).strict().parse(req.body);
    const encoded=await hashPassword(body.password);
    const user=await store.transaction(async()=> {
      if(await store.get('SELECT user_id FROM auth_credentials WHERE email=?',body.email))throw new HttpError(409,'EMAIL_IN_USE','이미 등록한 계정입니다. 로그인 후 초대 코드로 참여해 주세요.');
      const user={user_id:randomUUID(),name:body.name};
      await store.run('INSERT INTO users VALUES (?,?)',user.user_id,user.name);
      await consumeInvite(store,body.invite_code,user.user_id);
      await store.run('INSERT INTO auth_credentials VALUES (?,?,?)',user.user_id,body.email,encoded);return user;
    });
    await openSession(store,res,user.user_id,options.production);res.status(201).json(user);
  });
}
/** Run once using private server environment, never from a public signup request. */
export async function bootstrapProfessor(store:Database,input:{email:string;password:string;name:string;courseTitle:string}) {
  const address=email.parse(input.email),secret=password.parse(input.password),name=z.string().trim().min(1).max(120).parse(input.name),title=z.string().trim().min(1).max(200).parse(input.courseTitle);
  const encoded=await hashPassword(secret);
  return store.transaction(async()=> {
    const existing=await store.get<{user_id:string}>('SELECT user_id FROM auth_credentials WHERE email=?',address);
    if(existing)return {created:false,user_id:existing.user_id};
    const user=randomUUID(),course=randomUUID();
    await store.run('INSERT INTO users VALUES (?,?)',user,name);await store.run('INSERT INTO auth_credentials VALUES (?,?,?)',user,address,encoded);
    await store.run('INSERT INTO courses VALUES (?,?)',course,title);await store.run('INSERT INTO memberships VALUES (?,?,?)',user,course,'professor');
    for(let week=1;week<=15;week++)await store.run('INSERT INTO weeks VALUES (?,?,?,?)',randomUUID(),course,week,`${week}주차 학습`);
    return {created:true,user_id:user,course_id:course};
  });
}
