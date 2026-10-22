import {useEffect,useState,useRef} from 'react';
import {BarChart3,ChevronDown,ChevronLeft,ChevronRight,Clock,Download,LoaderCircle,MessageCircle,RefreshCw} from 'lucide-react';
import {api} from './api';
import {SourceCitations} from './SourceCitations';
import type {Week} from '../../backend/src/types';
import type {QuizReport,QAReport} from '../../backend/src/reports/types';
import type {ThreadState} from '../../backend/src/qa/types';
const percent=(value:number|null)=>value===null?'—':new Intl.NumberFormat('ko-KR',{style:'percent',maximumFractionDigits:1}).format(value);
const labels:Record<ThreadState,string>={open:'답변 준비 중',awaiting_student:'학생 보완 대기',awaiting_professor:'교수님 답변 대기',resolved:'답변 완료'};
const roleNames={student:'학생',assistant:'AI',professor:'교수님'};
export function ReportsPanel({courseId,weeks}:{courseId:string;weeks:Week[]}) {
 const [selected,setSelected]=useState(()=>weeks.map(w=>w.week_id)),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
 const [downloading,setDownloading]=useState(false),[downloadError,setDownloadError]=useState('');
 const downloadAbort=useRef<AbortController|null>(null);
 useEffect(()=>()=>downloadAbort.current?.abort(),[]);
 const [quiz,setQuiz]=useState<QuizReport|null>(null),[qa,setQA]=useState<QAReport|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const selection=selected.join(',');
 useEffect(()=> {
  setQuiz(null);setQA(null);setError('');if(!selection){setLoading(false);return}
  const controller=new AbortController();setLoading(true);
  const query=`week_ids=${encodeURIComponent(selection)}`;
  void Promise.all([api<QuizReport>(`/courses/${courseId}/reports/quizzes?${query}`,{signal:controller.signal}),api<QAReport>(`/courses/${courseId}/reports/qa?${query}&page=${page}&page_size=25`,{signal:controller.signal})]).then(([q,a])=>{if(!controller.signal.aborted){setQuiz(q);setQA(a)}}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'레포트를 불러오지 못했습니다.')}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[courseId,selection,page,refresh]);
 const choose=(ids:string[])=>{setSelected(ids);setPage(1);setDownloadError('')};
 async function download() {
  if(downloading||!selected.length)return;setDownloading(true);setDownloadError('');
  const controller=new AbortController();downloadAbort.current=controller;
  try {
   const response=await fetch(`/api/courses/${courseId}/reports/pdf?week_ids=${encodeURIComponent(selection)}`,{credentials:'same-origin',signal:controller.signal});
   if(!response.ok){const problem=await response.json().catch(()=>null);throw new Error(problem?.message||'PDF를 다운로드하지 못했습니다. 다시 시도해 주세요.')}
   if(!response.headers.get('Content-Type')?.includes('application/pdf'))throw new Error('PDF 응답을 확인하지 못했습니다. 다시 시도해 주세요.');
   const blob=await response.blob();if(controller.signal.aborted)return;
   const filename=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||'campus-report.pdf';
   const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }catch(error){if(!controller.signal.aborted)setDownloadError(error instanceof Error?error.message:'PDF를 다운로드하지 못했습니다.')}
  finally{if(!controller.signal.aborted)setDownloading(false)}
 }

 const all=selected.length===weeks.length;
 return <section className="reports" aria-label="교수 주차별 레포트">
  <section className="panel report-controls"><div className="report-control-heading"><div><h2>확인할 주차</h2><p className="helper">주차를 선택하면 퀴즈와 Q&A를 함께 조회해요.</p></div><div className="report-control-actions"><button className="secondary" disabled={loading||downloading||!selected.length} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={15}/>새로고침</button><button className="primary" disabled={loading||downloading||!selected.length||!!error} onClick={()=>void download()}>{downloading?<LoaderCircle size={15} className="spin"/>:<Download size={15}/>}PDF 다운로드</button></div></div>
   <fieldset className="report-week-picker"><legend className="sr-only">레포트 주차 선택</legend><label className="report-week-choice"><input type="checkbox" checked={all} disabled={downloading} onChange={e=>choose(e.target.checked?weeks.map(w=>w.week_id):[])}/>전체 주차 선택</label>{weeks.map(w=><label className={'report-week-choice '+(selected.includes(w.week_id)?'selected':'')} key={w.week_id}><input type="checkbox" checked={selected.includes(w.week_id)} disabled={downloading} onChange={e=>choose(e.target.checked?weeks.filter(week=>week.week_id===w.week_id||selected.includes(week.week_id)).map(week=>week.week_id):selected.filter(id=>id!==w.week_id))}/>{w.week_no}주차</label>)}</fieldset>
   <p className="report-period">{selected.length?`${selected.length}개 주차 선택`:'선택한 주차 없음'}{quiz&&<span>조회 {new Date(quiz.generated_at).toLocaleString('ko-KR')}</span>}</p>
  </section>
  {downloading&&<p className="helper" role="status">선택 주차의 전체 Q&A와 퀴즈를 PDF로 만들고 있어요.</p>}{downloadError&&<div className="alert" role="alert">{downloadError}</div>}
  {!selected.length?<div className="empty-review panel"><BarChart3 size={36}/><h3>확인할 주차를 하나 이상 선택해 주세요.</h3><p>전체 주차를 선택하면 강의 전체의 흐름을 볼 수 있어요.</p></div>:loading?<div className="processing" role="status"><LoaderCircle size={18} className="spin"/>제출 결과와 질문 내역을 집계하고 있어요.</div>:error?<div className="alert" role="alert"><span>{error}</span><button className="secondary" onClick={()=>setRefresh(n=>n+1)}>다시 조회</button></div>:quiz&&qa&&<>
   <section className="report-metrics" aria-label="선택 주차 요약"><article className="panel report-metric" aria-label="퀴즈 참여율"><p>퀴즈 참여율</p><strong>{percent(quiz.summary.participation_rate)}</strong><span>{quiz.summary.participant_count}명 / 현재 수강생 {quiz.summary.eligible_student_count}명</span><small>{quiz.summary.quiz_count?'선택 주차에서 퀴즈를 하나 이상 제출한 학생':'선택 주차에 게시된 퀴즈 없음'}</small></article><article className="panel report-metric" aria-label="퀴즈 정답률"><p>퀴즈 정답률</p><strong>{percent(quiz.summary.correct_rate)}</strong><span>{quiz.summary.correct_count}개 정답 / 제출 답안 {quiz.summary.answer_count}개</span><small>게시 {quiz.summary.question_count}문항 · 제출 {quiz.summary.submission_count}건</small></article><article className="panel report-metric report-metric-qa" aria-label="Q&A 요약"><p>학생 질문</p><strong>{qa.summary.thread_count}<small>건</small></strong><span>질문한 학생 {qa.summary.questioning_student_count}명</span><small>교수님 답변 대기 {qa.summary.awaiting_professor_count}건 · 응답 오류 {qa.summary.error_count}건</small></article></section>
   <section className="panel report-overview"><div className="report-section-title"><h2>주차별 학습 현황</h2><span className="helper">현재 수강생 {quiz.summary.eligible_student_count}명 기준</span></div><div className="report-table-scroll"><table className="report-table"><caption className="sr-only">선택한 주차별 퀴즈 참여율·정답률과 질문 수</caption><thead><tr><th scope="col">주차</th><th scope="col">게시 퀴즈 / 문항</th><th scope="col">참여 학생</th><th scope="col">참여율</th><th scope="col">정답률</th><th scope="col">Q&A</th></tr></thead><tbody>{quiz.weeks.map(w=><tr key={w.week_id}><th scope="row"><strong>{w.week_no}주차</strong><small>{w.title}</small></th><td>{w.quiz_count}개 / {w.question_count}문항</td><td>{w.participant_count} / {w.eligible_student_count}명</td><td><Rate value={w.participation_rate}/></td><td><Rate value={w.correct_rate}/><small>{w.correct_count} / {w.answer_count}개</small></td><td>{qa.weeks.find(a=>a.week_id===w.week_id)?.thread_count || 0}건</td></tr>)}</tbody></table></div>
    <details className="report-definitions"><summary>집계 기준 확인</summary><ul><li>참여율은 현재 수강 학생 중 게시 퀴즈를 하나 이상 제출한 학생의 비율이에요. 같은 학생의 여러 제출은 한 명으로 세요.</li><li>정답률은 현재 수강생이 제출한 전체 답안 중 정답 비율이에요. 미제출 답안을 오답으로 계산하지 않아요.</li><li>전체 정답률은 주차별 비율의 평균이 아닌, 정답 수와 제출 답안 수를 합쳐 계산해요. 퀴즈당 제출은 한 번이에요.</li><li>게시 퀴즈가 없거나 분모가 0이면 —로 표시해요. 수강생 구성이 바뀌면 퀴즈 집계도 달라져요.</li><li>Q&A는 선택한 주차의 저장된 대화 전체를 조회해요. 질문 상태는 조회 시점 기준이고 응답 오류는 상태 집계와 중복될 수 있어요.</li></ul></details>
   </section>
   <section aria-label="문항별 정답률"><div className="report-section-title"><h2>어떤 개념에서 막혔을까요?</h2><span className="helper">게시한 문항별 결과</span></div>{quiz.weeks.map(w=><details className="panel report-question-week" key={w.week_id}><summary><strong>{w.week_no}주차 · 문항별 결과</strong><span className="report-disclosure">{w.question_count}문항<ChevronDown size={16} className="report-chevron"/></span></summary>{!w.questions.length?<p className="helper report-empty">아직 게시한 퀴즈가 없어요.</p>:w.questions.map(q=><article className="report-question" key={`${q.quiz_id}:${q.question_id}`}><header><span className="eyebrow">퀴즈 {q.quiz_no} · {q.question_no}번</span><span className="report-question-rate">{percent(q.correct_rate)} <small>({q.correct_count}/{q.answer_count})</small></span></header><h3>{q.prompt}</h3><details className="report-answer"><summary>정답·풀이·출처 확인</summary><ol type="A">{q.options.map(o=><li className={o.option_id===q.correct_option_id?'report-correct':''} key={o.option_id}>{o.text}{o.option_id===q.correct_option_id&&<strong> · 정답</strong>}</li>)}</ol><p>{q.explanation}</p><SourceCitations sources={q.sources} professor/></details></article>)}</details>)}</section>
   <section className="panel report-qa" aria-label="Q&A 내역"><div className="report-section-title"><h2><MessageCircle size={19}/>Q&A 내역</h2><span className="helper">총 {qa.total_count}건</span></div><div className="report-qa-statuses">{(Object.entries(labels) as [ThreadState,string][]).map(([state,label])=><span className={'qa-state '+state} key={state}>{label} {qa.summary[`${state}_count`]}</span>)}{qa.summary.error_count>0&&<span className="report-error-badge">응답 오류 {qa.summary.error_count}</span>}</div>
    {!qa.threads.length?<div className="report-empty"><MessageCircle size={26}/><p>{qa.total_count?'이 페이지에는 질문이 없어요.':'선택한 주차에 아직 질문이 없어요.'}</p></div>:qa.threads.map(t=><details className="report-thread" key={t.thread_id}><summary><div><span className="eyebrow">{weeks.find(w=>w.week_id===t.week_id)?.week_no}주차 · {t.student_name}</span><strong>{t.messages[0]?.text}</strong><small>{new Date(t.created_at).toLocaleString('ko-KR')} · 추가 질문 {t.clarification_count}/1회</small></div><span className="report-thread-status"><span className={'qa-state '+t.state}>{t.error?'응답 오류':labels[t.state]}</span><ChevronDown size={16} className="report-chevron"/></span></summary><ol className="report-conversation">{t.messages.map(m=><li className={m.author_role} key={m.message_id}><strong>{roleNames[m.author_role]}{m.kind==='clarification'?' · 추가 질문':''}</strong><p>{m.text}</p>{m.sources.length>0&&<SourceCitations sources={m.sources} professor/>}</li>)}</ol>{t.error&&<div className="report-thread-error"><Clock size={15}/><p>{t.error.message}</p></div>}</details>)}
    {qa.page_count>1&&<nav className="report-pagination" aria-label="Q&A 페이지"><button className="secondary" aria-label="이전 Q&A 페이지" disabled={page<=1} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={16}/>이전</button><span>{page} / {qa.page_count}페이지 · 전체 {qa.total_count}건</span><button className="secondary" aria-label="다음 Q&A 페이지" disabled={page>=qa.page_count} onClick={()=>setPage(p=>p+1)}>다음<ChevronRight size={16}/></button></nav>}
   </section>
  </>}
 </section>;
}
function Rate({value}:{value:number|null}) {return <div className="report-rate"><strong>{percent(value)}</strong>{value!==null&&<span aria-hidden="true"><i style={{width:`${value*100}%`}}/></span>}</div>}
