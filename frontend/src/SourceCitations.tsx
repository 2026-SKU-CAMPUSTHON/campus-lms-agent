import {useState} from 'react';
import {Play} from 'lucide-react';
import type {Source} from '../../backend/src/types';
export function clock(seconds:number) {const total=Math.max(0,Math.floor(seconds));return total>=3600?`${Math.floor(total/3600)}:${String(Math.floor(total/60)%60).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`:`${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`}
export function MediaPlayer({id,kind,start,end,youtube=false}:{id:string;kind:'audio'|'video';start:number;end:number;youtube?:boolean}) {
 if(youtube)return <a className="youtube-source-link" href={`/api/materials/${id}/playback?start=${start}`} target="_blank" rel="noreferrer">YouTube에서 {clock(start)}부터 보기 ↗</a>;
 const props={controls:true,preload:'metadata',src:`/api/materials/${id}/playback#t=${start},${end}`,onLoadedMetadata:(e:React.SyntheticEvent<HTMLMediaElement>)=>{e.currentTarget.currentTime=start},onTimeUpdate:(e:React.SyntheticEvent<HTMLMediaElement>)=>{if(e.currentTarget.currentTime>=end)e.currentTarget.pause()}};
 return kind==='video'?<video {...props} className="media-player"/>:<audio {...props} className="media-player"/>;
}
export function SourceCitations({sources,professor=false}:{sources:Source[];professor?:boolean}) {
 const [opened,setOpened]=useState<string|null>(null);
 return <div className="source-citations" aria-label="답변 출처">{sources.map(s=>s.source_type==='document'?<span className="source" key={s.chunk_id}>{s.material_name || '강의 자료'} · {s.slide_no}p</span>:<div className="transcript-citation" key={s.chunk_id}><span className="source">{s.material_name} · {clock(s.start_sec)}–{clock(Math.ceil(s.end_sec))}</span>{professor||s.original_visible_to_students?<button type="button" className="text-button citation-play" onClick={()=>setOpened(opened===s.chunk_id?null:s.chunk_id)}><Play size={13}/>{opened===s.chunk_id?'재생기 닫기':'해당 구간 재생'}</button>:<small>원본 비공개</small>}{opened===s.chunk_id&&(professor||s.original_visible_to_students)&&<MediaPlayer key={s.chunk_id} id={s.material_id} kind={s.media_type} start={s.start_sec} end={s.end_sec} youtube={s.origin==='youtube'}/>}</div>)}</div>;
}
