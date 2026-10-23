import {useState} from 'react';
import {post} from './api';
import type {User} from '../../backend/src/types';
export function AuthPanel({onUser}:{onUser:(user:User)=>void}) {
 const [register,setRegister]=useState(false),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState(''),[invite,setInvite]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(event:React.FormEvent){event.preventDefault();if(busy)return;setBusy(true);setError('');try{onUser(await post<User>(register?'/auth/register':'/auth/login',register?{email,password,name,invite_code:invite.trim()}:{email,password}))}catch(error){setError(error instanceof Error?error.message:'로그인을 완료하지 못했습니다.')}finally{setBusy(false)}}
 return <section className="login-panel"><span className="mode-tag">캠퍼스 학습실</span><h2>{register?'초대받은 강의에 참여하기':'학습실 로그인'}</h2><p>{register?'교수님이나 팀원에게 받은 초대 코드로 가입해 주세요.':'등록한 이메일과 비밀번호를 입력해 주세요.'}</p><form className="auth-form" onSubmit={event=>void submit(event)}>
 {register&&<label className="field">이름<input autoComplete="name" value={name} onChange={event=>setName(event.target.value)} required maxLength={120} disabled={busy}/></label>}
 <label className="field">이메일<input type="email" autoComplete="username" value={email} onChange={event=>setEmail(event.target.value)} required maxLength={254} disabled={busy}/></label>
 <label className="field">비밀번호<input type="password" autoComplete={register?'new-password':'current-password'} minLength={register?12:1} maxLength={128} value={password} onChange={event=>setPassword(event.target.value)} required disabled={busy}/></label>
 {register&&<><p className="helper">비밀번호는 12자 이상으로 설정해 주세요.</p><label className="field">초대 코드<input autoComplete="off" value={invite} onChange={event=>setInvite(event.target.value)} required disabled={busy}/></label></>}
 {error&&<div className="alert" role="alert">{error}</div>}<button className="primary wide" type="submit" disabled={busy}>{busy?'확인 중…':register?'가입하고 참여하기':'로그인'}</button></form>
 <button className="text-button auth-switch" type="button" disabled={busy} onClick={()=>{setRegister(!register);setError('');setPassword('')}}>{register?'이미 계정이 있어요 · 로그인':'초대 코드로 가입하기'}</button><p className="login-note">교수·학생 권한은 강의 초대에 따라 적용됩니다.</p></section>;
}
