import {createHash} from 'node:crypto';
import {isDocument,type Material} from '../types.js';
import type {Passage} from '../qa/types.js';
const stop=new Set(['설명','해주세요','알려주세요','무엇','어떻게','대해','이거','그거','네','the','is','a','of','and','what','how']);
export function terms(text:string,maximum=512):string[] {
 const words=text.normalize('NFKC').toLowerCase().match(/[a-z0-9_]{2,32}|[\p{Script=Hangul}]{2,32}/gu)||[];
 const tokens:string[]=[];
 for(const word of words) {
  if(stop.has(word))continue;tokens.push(word);
  if(/\p{Script=Hangul}/u.test(word))for(let i=0;i<word.length-1;i++)tokens.push(word.slice(i,i+2));
 }
 return [...new Set(tokens)].slice(0,maximum);
}
function sourceId(material:string,page:number|string,part:number) {
 const h=createHash('sha256').update(`${material}:${page}:${part}`).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
}
/** 로컬 시연용 단어 검색. Supabase 벡터 검색으로 교체할 경계다. */
export function materialPassages(materials:Material[],course:string,week:string):Passage[] {
 const candidates:Passage[]=[];
 for(const m of materials) {
  if(m.course_id!==course||m.week_id!==week||m.status!=='completed')continue;
  if(isDocument(m))for(const slide of m.slides) {
   if(slide.slide_no<m.slide_start||slide.slide_no>m.slide_end)continue;
   for(let offset=0;offset<slide.text.length;offset+=840) {
    const text=slide.text.slice(offset,offset+1000).trim();if(!text)continue;
    candidates.push({source:{material_id:m.material_id,chunk_id:sourceId(m.material_id,slide.slide_no,offset),source_type:'document',material_name:m.name,slide_no:slide.slide_no,start_sec:null,end_sec:null},text,score:0});
   }
  } else {
   let group:{start_sec:number;end_sec:number;text:string}|null=null;
   const add=(part:NonNullable<typeof group>)=> {
    for(let offset=0;offset<part.text.length;offset+=840) {
     const text=part.text.slice(offset,offset+1000).trim();if(!text)continue;
     candidates.push({source:{material_id:m.material_id,chunk_id:sourceId(m.material_id,`t:${part.start_sec}:${part.end_sec}`,offset),source_type:'transcript',material_name:m.name,media_type:m.source_type,original_visible_to_students:m.original_visible_to_students,slide_no:null,start_sec:part.start_sec,end_sec:part.end_sec,...(m.youtube?{origin:'youtube' as const}:{})},text,score:0});
    }
   };
   for(const segment of m.segments) {
    if(group&&(group.text.length+segment.text.length>1000||segment.end_sec-group.start_sec>60||segment.start_sec-group.end_sec>10)){add(group);group=null}
    group=group?{start_sec:group.start_sec,end_sec:Math.max(group.end_sec,segment.end_sec),text:group.text+' '+segment.text}:{...segment};
   }
   if(group)add(group);
  }
 }
 return candidates;
}
export function retrieve(materials:Material[],course:string,week:string,query:string,limit=6):Passage[] {
 const candidates=materialPassages(materials,course,week);
 const queryTerms=terms(query,128);if(!queryTerms.length)return [];
 const documentTerms=candidates.map(c=>new Set(terms(c.text)));
 const frequencies=new Map(queryTerms.map(t=>[t,documentTerms.filter(tokens=>tokens.has(t)).length]));
 candidates.forEach((candidate,i)=> {
  candidate.score=queryTerms.reduce((score,term)=>score+(documentTerms[i].has(term)?Math.log(1+(candidates.length+1)/((frequencies.get(term)||0)+1)):0),0);
 });
 const seen=new Set<string>();
 return candidates.filter(c=>c.score>0).sort((a,b)=>b.score-a.score).filter(c=>{const text=c.text.replace(/\s/g,'');if(seen.has(text))return false;seen.add(text);return true}).slice(0,limit);
}
