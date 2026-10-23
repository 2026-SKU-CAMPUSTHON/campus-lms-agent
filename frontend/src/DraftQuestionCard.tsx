import {useRef,useState} from 'react';
import {Check,LoaderCircle,Pencil,Save,X} from 'lucide-react';
import {api} from './api';
import {SourceCitations} from './SourceCitations';
import type {DraftQuestion,QuizDraft} from '../../backend/src/types';
interface Props {question:DraftQuestion;index:number;draftId:string;version:number;selected:boolean;published:boolean;busy:boolean;editing:boolean;editorOpen:boolean;onSelect:(selected:boolean)=>void;onEdit:()=>void;onCancel:()=>void;onSaved:(draft:QuizDraft)=>void;onReload:()=>Promise<void>}
function editable(q:DraftQuestion){return {prompt:q.prompt,options:q.options.map(o=>({...o})),correct_option_id:q.correct_option_id,explanation:q.explanation}}
export function DraftQuestionCard({question:q,index,draftId,version,selected,published,busy,editing,editorOpen,onSelect,onEdit,onCancel,onSaved,onReload}:Props) {
 const [form,setForm]=useState(()=>editable(q)),[saving,setSaving]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
 const request=useRef<{fingerprint:string;key:string}|null>(null);
 function begin(){setForm(editable(q));setError('');setConflict(false);request.current=null;onEdit()}
 async function save(event:React.FormEvent){
  event.preventDefault();if(saving)return;setError('');setConflict(false);
  if(!form.prompt.trim()||!form.explanation.trim()||form.options.some(o=>!o.text.trim())){setError('문제·보기 네 개·풀이를 모두 입력해 주세요.');return}
  if(new Set(form.options.map(o=>o.text.trim().normalize('NFKC').replace(/\s+/g,' ').toLocaleLowerCase())).size!==4){setError('보기 내용이 서로 겹치지 않도록 수정해 주세요.');return}
  const body=JSON.stringify({...form,expected_version:version});if(request.current?.fingerprint!==body)request.current={fingerprint:body,key:crypto.randomUUID()};
  setSaving(true);
  try{const draft=await api<QuizDraft>(`/quiz-drafts/${draftId}/questions/${q.question_id}`,{method:'PATCH',body,headers:{'Idempotency-Key':request.current.key}});onSaved(draft)}
  catch(e){setError(e instanceof Error?e.message:'수정 내용을 저장하지 못했습니다.');setConflict(typeof e==='object'&&e!==null&&'status' in e&&e.status===409)}
  finally{setSaving(false)}
 }
 async function reload(){setSaving(true);try{await onReload()}catch(e){setError(e instanceof Error?e.message:'최신 초안을 불러오지 못했습니다.')}finally{setSaving(false)}}
 return <article className={'question-card '+(selected?'selected ':'')+(editing?'question-editing':'')} aria-label={`${index+1}번 문제 검토`}>
  <div className="question-top"><label className="checkbox-line"><input type="checkbox" aria-label={`${index+1}번 문제 선택`} checked={selected} disabled={busy||published||editorOpen} onChange={e=>onSelect(e.target.checked)}/><strong>문제 {String(index+1).padStart(2,'0')}</strong></label><SourceCitations sources={q.sources} professor/></div>
  {editing?<form className="question-editor" onSubmit={save} aria-label={`${index+1}번 문제 수정`}>
   <p className="helper">수정 내용을 저장한 뒤 게시해 주세요. 페이지·영상 시간 출처는 유지돼요. 바꾼 내용이 출처와 맞는지도 확인해 주세요.</p>
   <label className="field">문제<textarea aria-label="문제" required maxLength={2000} rows={3} value={form.prompt} disabled={saving} onChange={e=>setForm({...form,prompt:e.target.value})}/></label>
   <fieldset className="edit-options"><legend>보기·정답</legend><p className="helper">정답인 보기 하나를 선택해 주세요.</p>{form.options.map(o=><div className={'edit-option '+(o.option_id===form.correct_option_id?'correct':'')} key={o.option_id}><label className="edit-correct-choice"><input type="radio" name={`correct-${q.question_id}`} aria-label={`${o.option_id.toUpperCase()} 정답`} checked={o.option_id===form.correct_option_id} disabled={saving} onChange={()=>setForm({...form,correct_option_id:o.option_id})}/><span>{o.option_id.toUpperCase()}</span></label><label className="sr-only" htmlFor={`${q.question_id}-${o.option_id}`}>보기 {o.option_id.toUpperCase()}</label><textarea id={`${q.question_id}-${o.option_id}`} required maxLength={1000} rows={2} value={o.text} disabled={saving} onChange={e=>setForm({...form,options:form.options.map(current=>current.option_id===o.option_id?{...current,text:e.target.value}:current)})}/></div>)}</fieldset>
   <label className="field">풀이<textarea aria-label="풀이" required maxLength={4000} rows={4} value={form.explanation} disabled={saving} onChange={e=>setForm({...form,explanation:e.target.value})}/></label>
   {error&&<div className="editor-error" role="alert"><p>{error}</p>{conflict&&<button className="secondary" type="button" disabled={saving} onClick={()=>void reload()}>수정 취소하고 최신 초안 보기</button>}</div>}
   <div className="editor-actions"><button className="secondary" type="button" disabled={saving} onClick={onCancel}><X size={15}/>수정 취소</button><button className="primary" disabled={saving} type="submit">{saving?<LoaderCircle size={15} className="spin"/>:<Save size={15}/>}수정 내용 저장</button></div>
  </form>:<><h3>{q.prompt}</h3><div className="review-options">{q.options.map(o=><div className={o.option_id===q.correct_option_id?'correct':''} key={o.option_id}><span>{o.option_id.toUpperCase()}</span>{o.text}{o.option_id===q.correct_option_id&&<Check size={16}/>}</div>)}</div><details><summary>풀이 확인</summary><p>{q.explanation}</p></details><div className="question-edit-toolbar">{published?<small>게시한 문제예요.</small>:<button className="secondary" type="button" disabled={busy||editorOpen} onClick={begin}><Pencil size={14}/>문제 수정</button>}</div></>}
 </article>;
}
