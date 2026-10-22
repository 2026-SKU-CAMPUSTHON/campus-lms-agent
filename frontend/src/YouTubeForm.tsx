import {useRef,useEffect,useState} from 'react';
import {Link,LoaderCircle} from 'lucide-react';
import {post} from './api';
import {clock} from './SourceCitations';
import {parseYouTubeUrl} from '../../backend/src/media/youtube-url';
export function YouTubeForm({base,onAccepted}:{base:string;onAccepted:()=>void}) {
 const [url,setUrl]=useState(''),[start,setStart]=useState('0'),[end,setEnd]=useState(''),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const live=useRef(true);useEffect(()=>{live.current=true;return()=>{live.current=false}},[]);
 function changeUrl(value:string) {setUrl(value);try{setStart(String(parseYouTubeUrl(value).start_sec))}catch{if(!value)setStart('0')}}
 async function submit(event:React.FormEvent) {
  event.preventDefault();if(busy)return;setBusy(true);setError('');
  try {
   parseYouTubeUrl(url);const a=Number(start),b=end===''?null:Number(end);
   if(!Number.isInteger(a)||a<0||a>=7200||b!==null&&(!Number.isInteger(b)||b<=a||b>7200))throw new Error('시작·끝 시간을 확인해 주세요. 전체 길이 120분 이하의 영상을 지원해요.');
   await post(base+'/youtube',{url,start_sec:a,end_sec:b,original_visible_to_students:visible});
   if(live.current){setUrl('');setStart('0');setEnd('');onAccepted()}
  }catch(e){if(live.current)setError(e instanceof Error?e.message:'YouTube 자료를 가져오지 못했습니다.')}
  finally{if(live.current)setBusy(false)}
 }
 return <form className="panel media-upload youtube-form" onSubmit={submit} aria-label="YouTube 등록">
  <div className="youtube-heading"><Link size={21}/><h2>YouTube 강의 연결</h2></div>
  <p className="helper">자막을 먼저 가져오고, 없으면 음성을 전사해 이번 주 Q&A 근거로 사용해요.</p>
  <label className="field">YouTube 영상 링크<input type="url" required value={url} disabled={busy} placeholder="https://www.youtube.com/watch?v=..." onChange={e=>changeUrl(e.target.value)}/></label>
  <div className="youtube-range"><label className="field">시작 시간 (초)<input type="number" required min="0" max="7199" step="1" value={start} disabled={busy} onChange={e=>setStart(e.target.value)}/></label><label className="field">끝 시간 (초)<input type="number" min={Number(start)+1} max="7200" step="1" value={end} disabled={busy} placeholder="영상 끝까지" onChange={e=>setEnd(e.target.value)}/></label></div>
  <p className="youtube-selection">{clock(Number(start)||0)}부터 {end?clock(Number(end)):'영상 끝까지'} · 링크의 시작 시간을 반영해요.</p>
  <label className="checkbox-line"><input type="checkbox" checked={visible} disabled={busy} onChange={e=>setVisible(e.target.checked)}/>학생에게 YouTube 원본 링크·전체 전사 공개</label>
  <p className="helper">이 앱의 공개 범위만 정해요. YouTube 자체의 영상 공개 상태는 바뀌지 않아요.</p>
  {error&&<div className="alert" role="alert">{error}</div>}
  <button className="primary wide" disabled={busy||!url.trim()} type="submit">{busy?<LoaderCircle size={16} className="spin"/>:<Link size={16}/>}YouTube 근거 가져오기</button>
  <p className="helper">전체 길이 120분 이하의 공개 영상. 접근이 제한되면 녹음·동영상 파일로 올려 주세요.</p>
 </form>;
}
