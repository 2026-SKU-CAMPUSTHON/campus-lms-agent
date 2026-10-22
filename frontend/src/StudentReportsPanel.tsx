import {useEffect,useState} from 'react';
import {BookOpen,Download,LoaderCircle,RefreshCw} from 'lucide-react';
import {api} from './api';
import {usePDFDownload} from './usePDFDownload';
import type {Week} from '../../backend/src/types';
import type {StudentWrongReport} from '../../backend/src/reports/types';
const percent=(value:number|null)=>value===null?'—':new Intl.NumberFormat('ko-KR',{style:'percent',maximumFractionDigits:1}).format(value);
export function StudentReportsPanel({courseId,weeks}:{courseId:string;weeks:Week[]}) {
 const [selected,setSelected]=useState(()=>weeks.map(w=>w.week_id)),[report,setReport]=useState<StudentWrongReport|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const {downloading,downloadError,clearDownloadError,download}=usePDFDownload(),selection=selected.join(','),base=`/api/courses/${courseId}/reports/wrong-answers`;
 useEffect(()=> {
  setReport(null);setError('');if(!selection){setLoading(false);return}
  const controller=new AbortController();setLoading(true);
  void api<StudentWrongReport>(`/courses/${courseId}/reports/wrong-answers?week_ids=${encodeURIComponent(selection)}`,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setReport(data)}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'오답 레포트를 불러오지 못했습니다.')}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[courseId,selection,refresh]);
 function choose(ids:string[]){setSelected(ids);clearDownloadError()}
 return <section className="reports" aria-label="나의 주차별 오답 레포트">
  <section className="panel report-controls"><div className="report-control-heading"><div><h2>복습할 주차</h2><p className="helper">내가 제출한 퀴즈의 오답·정답·풀이를 PDF로 받아요.</p></div><div className="report-control-actions"><button className="secondary" disabled={loading||downloading||!selected.length} onClick={()=>{clearDownloadError();setRefresh(n=>n+1)}}><RefreshCw size={15}/>새로고침</button><button className="primary" disabled={loading||downloading||!selected.length||!!error} onClick={()=>void download(base+'/pdf?week_ids='+encodeURIComponent(selection))}>{downloading?<LoaderCircle size={15} className="spin"/>:<Download size={15}/>}오답 PDF 다운로드</button></div></div>
   <fieldset className="report-week-picker"><legend className="sr-only">오답 레포트 주차 선택</legend><label className="report-week-choice"><input type="checkbox" checked={selected.length===weeks.length} disabled={downloading} onChange={e=>choose(e.target.checked?weeks.map(w=>w.week_id):[])}/>전체 주차 선택</label>{weeks.map(w=><label className={'report-week-choice '+(selected.includes(w.week_id)?'selected':'')} key={w.week_id}><input type="checkbox" checked={selected.includes(w.week_id)} disabled={downloading} onChange={e=>choose(e.target.checked?weeks.filter(week=>week.week_id===w.week_id||selected.includes(week.week_id)).map(week=>week.week_id):selected.filter(id=>id!==w.week_id))}/>{w.week_no}주차</label>)}</fieldset>
   <p className="report-period">{selected.length?`${selected.length}개 주차 선택`:'선택한 주차 없음'}{report&&<span>조회 {new Date(report.generated_at).toLocaleString('ko-KR')}</span>}</p>
  </section>
  {downloading&&<p className="helper" role="status">선택 주차의 나의 오답 PDF를 만들고 있어요.</p>}{downloadError&&<div className="alert" role="alert">{downloadError}</div>}
  {!selected.length?<div className="empty-review panel"><BookOpen size={36}/><h3>복습할 주차를 하나 이상 선택해 주세요.</h3></div>:loading?<div className="processing" role="status"><LoaderCircle size={18} className="spin"/>나의 제출 결과를 확인하고 있어요.</div>:error?<div className="alert" role="alert"><span>{error}</span><button className="secondary" onClick={()=>setRefresh(n=>n+1)}>다시 조회</button></div>:report&&<>
   <section className="report-metrics" aria-label="나의 선택 주차 요약"><article className="panel report-metric" aria-label="제출한 퀴즈"><p>제출한 퀴즈</p><strong>{report.summary.submission_count}<small>개</small></strong><span>풀이한 문제 {report.summary.total_count}개</span></article><article className="panel report-metric" aria-label="틀린 문제"><p>틀린 문제</p><strong>{report.summary.wrong_count}<small>개</small></strong><span>내 선택·정답·풀이·출처 포함</span></article><article className="panel report-metric" aria-label="나의 정답률"><p>나의 정답률</p><strong>{percent(report.summary.correct_rate)}</strong><span>{report.summary.correct_count}개 정답 / {report.summary.total_count}개 풀이</span></article></section>
   <section className="panel report-overview"><div className="report-section-title"><h2>주차별 복습 기록</h2><span className="helper">본인의 제출 결과만 표시돼요.</span></div><div className="report-table-scroll"><table className="report-table"><caption className="sr-only">주차별 나의 퀴즈 제출·오답 현황</caption><thead><tr><th scope="col">주차</th><th scope="col">제출 퀴즈</th><th scope="col">풀이 문항</th><th scope="col">오답</th><th scope="col">정답률</th></tr></thead><tbody>{report.weeks.map(w=><tr key={w.week_id}><th scope="row"><strong>{w.week_no}주차</strong><small>{w.title}</small></th><td>{w.submission_count}개</td><td>{w.total_count}개</td><td>{w.wrong_count}개</td><td>{percent(w.correct_rate)}</td></tr>)}</tbody></table></div><p className="helper">PDF에는 선택한 주차의 모든 제출 결과 중 틀린 문제만 담아요. 아직 풀지 않은 퀴즈의 정답은 포함하지 않아요.</p></section>
   {!report.summary.submission_count?<div className="notice">선택한 주차에 아직 제출한 퀴즈가 없어요. PDF에도 미응시 상태로 표시해요.</div>:!report.summary.wrong_count?<div className="notice">제출한 퀴즈를 모두 맞혔어요. PDF에 오답 없음으로 표시해요.</div>:null}
  </>}
 </section>;
}
