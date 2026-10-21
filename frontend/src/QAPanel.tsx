import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,Clock,LoaderCircle,MessageCircle,RefreshCw,Send,UserRound} from 'lucide-react';
import {api,post} from './api';
import type {QAThread} from '../../backend/src/qa/types';
const labels={open:'답변 준비 중',awaiting_student:'추가 답변 필요',awaiting_professor:'교수님 답변 대기',resolved:'답변 완료'};
const reasons={unclear_after_clarification:'한 번 더 확인했지만 질문의 대상을 명확히 이해하지 못했어요.',insufficient_evidence:'강의 자료에서 충분한 답변 근거를 찾지 못했어요.',judgment_uncertain:'AI 판단이 불확실해서 교수님께 확인을 요청했어요.',answer_not_grounded:'답변의 출처를 충분히 확인하지 못해 교수님께 넘겼어요.'};
export function QAPanel({courseId,weekId,professor}:{courseId:string;weekId:string;professor:boolean}) {
 const [threads,setThreads]=useState<QAThread[]>([]),[selected,setSelected]=useState(''),[thread,setThread]=useState<QAThread|null>(null),[question,setQuestion]=useState(''),[reply,setReply]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [pollVersion,setPollVersion]=useState(0);
 const mounted=useRef(true),generation=useRef(0),busyRef=useRef(false);
 const base=`/courses/${courseId}/weeks/${weekId}/threads`;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++}},[]);
 const list=useCallback(async()=> {const data=await api<QAThread[]>(base);if(mounted.current)setThreads(data)},[base]);
 useEffect(()=>{let active=true;void api<QAThread[]>(base).then(data=>{if(active)setThreads(data)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[base]);
 useEffect(()=> {
  if(!selected){setThread(null);return}let active=true;let timer:ReturnType<typeof setTimeout>|undefined;
  const token=++generation.current;
  const refresh=async()=> {
   try {const latest=await api<QAThread>('/threads/'+selected);if(!active||token!==generation.current)return;setThread(latest);
    if(['queued','processing'].includes(latest.processing_status))timer=setTimeout(()=>void refresh(),1200);else void list();
   }catch(e){if(active&&token===generation.current)setError(e instanceof Error?e.message:'질문을 불러오지 못했습니다.')}
  };void refresh();return()=>{active=false;if(timer)clearTimeout(timer)};
 },[selected,list,pollVersion]);
 async function act(work:()=>Promise<void>) {if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');try{await work()}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'요청을 처리하지 못했습니다.')}finally{busyRef.current=false;if(mounted.current)setBusy(false)}}
 const beginPolling=(updated:QAThread)=>{setThread(updated);setSelected(updated.thread_id);setPollVersion(value=>value+1)};
 const sendQuestion=()=>void act(async()=>{const updated=await post<QAThread>(base,{text:question},crypto.randomUUID());if(mounted.current){setQuestion('');beginPolling(updated);await list()}});
 const sendReply=()=>void act(async()=>{if(!thread)return;const updated=await post<QAThread>(`/threads/${thread.thread_id}/messages`,{text:reply,expected_version:thread.version},crypto.randomUUID());if(mounted.current){setReply('');beginPolling(updated);await list()}});
 const retry=()=>void act(async()=>{if(!thread)return;const updated=await post<QAThread>(`/threads/${thread.thread_id}/retry`,{expected_version:thread.version},crypto.randomUUID());if(mounted.current)beginPolling(updated)});
 const processing=thread&&['queued','processing'].includes(thread.processing_status);
 const canReply=thread&&!processing&&!thread.error&&((professor&&thread.state==='awaiting_professor')||(!professor&&thread.state==='awaiting_student'));
 return <section className="qa-layout" aria-label="강의 Q&A"><div className="qa-list panel"><div className="section-title"><h2>{professor?'학생 질문함':'나의 질문'}</h2><button className="icon-button" aria-label="질문 목록 새로고침" disabled={busy} onClick={()=>void act(list)}><RefreshCw size={16}/></button></div><p className="helper">{professor?'AI가 넘긴 질문의 대화와 출처를 확인하고 답변해 주세요.':'이 주차에 등록된 강의 자료를 바탕으로 질문해 보세요.'}</p>
 {!professor&&<form className="qa-new" onSubmit={e=>{e.preventDefault();sendQuestion()}}><label htmlFor="qa-question">새 질문<textarea id="qa-question" maxLength={4000} rows={4} placeholder="예: TF-IDF와 카운트 벡터화는 어떻게 다른가요?" value={question} disabled={busy} onChange={e=>setQuestion(e.target.value)}/></label><button className="primary wide" type="submit" disabled={busy||!question.trim()}>질문하기<ArrowRight size={16}/></button></form>}
 {loading?<p className="muted">질문을 불러오고 있어요.</p>:!threads.length?<div className="qa-no-threads"><MessageCircle size={26}/><p>{professor?'아직 학생 질문이 없어요.':'아직 작성한 질문이 없어요.'}</p></div>:<div className="qa-thread-list">{threads.map(t=><button key={t.thread_id} className={'qa-thread-button '+(selected===t.thread_id?'active':'')} disabled={busy} onClick={()=>{if(selected!==t.thread_id)setThread(null);setSelected(t.thread_id);setReply('');setError('')}}><span className={'qa-state '+t.state}>{t.processing_status==='failed'?'응답 오류':labels[t.state]}</span><strong>{t.messages[0]?.text}</strong><small>{professor?t.student_name:`추가 질문 ${t.clarification_count}/1회`} · {new Date(t.created_at).toLocaleDateString('ko-KR')}</small></button>)}</div>}</div>
 <div className="qa-conversation">{error&&<div className="alert" role="alert">{error}</div>}{!thread?<div className="empty-review panel"><MessageCircle size={44}/><h3>{selected?'질문을 불러오고 있어요.':'질문과 답변을 한곳에서'}</h3><p>질문을 선택하면 AI와 교수님의 답변을 확인할 수 있어요.<br/>추가 질문은 한 번만 진행해요.</p></div>:<article className="panel qa-chat"><header className="qa-chat-heading"><div><p className="eyebrow">강의 자료 기반 Q&A</p><h2>{professor?`${thread.student_name}의 질문`:'나의 질문과 답변'}</h2></div><span className={'qa-state '+thread.state}>{thread.error?'응답 오류':labels[thread.state]}</span></header>
 <ol className="qa-messages">{thread.messages.map(m=><li key={m.message_id} className={'qa-message '+m.author_role}><div className="qa-author">{m.author_role==='student'?<UserRound size={14}/>:m.author_role==='professor'?<Check size={14}/>:<MessageCircle size={14}/>}<strong>{m.author_role==='student'?'학생':m.author_role==='professor'?'교수님':m.kind==='clarification'?'AI 추가 질문 · 1회':'AI 답변'}</strong></div><p>{m.text}</p>{m.sources.length>0&&<div className="qa-sources" aria-label="답변 출처">{m.sources.map(s=><span className="source" key={s.chunk_id}>강의 자료 {s.slide_no}p</span>)}</div>}</li>)}</ol>
 {processing&&<div className="processing" role="status"><LoaderCircle className="spin" size={18}/>강의 자료를 검색하고 답변을 확인하고 있어요.</div>}
 {thread.error&&<div className="qa-error" role="alert"><strong>응답을 완료하지 못했어요.</strong><p>{thread.error.message}</p><p className="helper">질문과 대화는 저장됐어요. 연결 문제를 답변 근거 부족으로 처리하지 않아요.</p>{thread.error.retryable&&<button className="secondary" disabled={busy} onClick={retry}><RefreshCw size={15}/>응답 다시 시도</button>}</div>}
 {thread.state==='awaiting_professor'&&!thread.error&&<div className="qa-handoff"><Clock size={18}/><div><strong>교수님께 질문을 넘겼어요.</strong><p>{thread.handoff_reason?reasons[thread.handoff_reason]:'교수님의 답변을 기다리고 있어요.'}</p></div></div>}
 {canReply&&<form className="qa-reply" onSubmit={e=>{e.preventDefault();sendReply()}}><label htmlFor="qa-reply">{professor?'교수님 답변':'추가 질문에 답변'}<textarea id="qa-reply" maxLength={4000} rows={4} placeholder={professor?'학생에게 설명할 내용을 입력해 주세요.':'어떤 개념을 질문했는지 구체적으로 알려 주세요.'} value={reply} onChange={e=>setReply(e.target.value)} disabled={busy}/></label><p className="helper">{professor?'답변을 남기면 이 질문은 답변 완료로 표시돼요.':'답변을 보내면 자료를 다시 검색해요. 여전히 해결하지 못하면 교수님께 넘겨요.'}</p><button className="primary" disabled={busy||!reply.trim()} type="submit">{professor?'답변 등록하기':'추가 답변 보내기'}<Send size={15}/></button></form>}
 {thread.state==='resolved'&&<div className="notice"><Check size={17}/>답변이 완료된 질문이에요.</div>}
 </article>}</div></section>;
}
