import {createHash} from 'node:crypto';
import type {Material} from '../types.js';
import type {Passage} from '../qa/types.js';
const stop=new Set(['설명','해주세요','알려주세요','무엇','어떻게','대해','이거','그거','네','the','is','a','of','and','what','how']);
export function terms(text:string):string[] {
 const words=text.normalize('NFKC').toLowerCase().match(/[a-z0-9_]{2,32}|[\p{Script=Hangul}]{2,32}/gu)||[];
 const tokens:string[]=[];
 for(const word of words) {
  if(stop.has(word))continue;tokens.push(word);
  if(/\p{Script=Hangul}/u.test(word))for(let i=0;i<word.length-1;i++)tokens.push(word.slice(i,i+2));
 }
 return [...new Set(tokens)].slice(0,128);
}
function sourceId(material:string,page:number,part:number) {
 const h=createHash('sha256').update(`${material}:${page}:${part}`).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
}
/** 로컬 시연용 단어 검색. Supabase 벡터 검색으로 교체할 경계다. */
export function retrieve(materials:Material[],course:string,week:string,query:string,limit=6):Passage[] {
 const candidates:Passage[]=[];
 for(const m of materials) {
  if(m.course_id!==course||m.week_id!==week||m.status!=='completed')continue;
  for(const slide of m.slides) {
   if(slide.slide_no<m.slide_start||slide.slide_no>m.slide_end)continue;
   for(let offset=0;offset<slide.text.length;offset+=840) {
    const text=slide.text.slice(offset,offset+1000).trim();if(!text)continue;
    candidates.push({source:{material_id:m.material_id,chunk_id:sourceId(m.material_id,slide.slide_no,offset),source_type:'document',slide_no:slide.slide_no,start_sec:null,end_sec:null},text,score:0});
   }
  }
 }
 const queryTerms=terms(query);if(!queryTerms.length)return [];
 const documentTerms=candidates.map(c=>new Set(terms(c.text)));
 const frequencies=new Map(queryTerms.map(t=>[t,documentTerms.filter(tokens=>tokens.has(t)).length]));
 candidates.forEach((candidate,i)=> {
  candidate.score=queryTerms.reduce((score,term)=>score+(documentTerms[i].has(term)?Math.log(1+(candidates.length+1)/((frequencies.get(term)||0)+1)):0),0);
 });
 const seen=new Set<string>();
 return candidates.filter(c=>c.score>0).sort((a,b)=>b.score-a.score).filter(c=>{const text=c.text.replace(/\s/g,'');if(seen.has(text))return false;seen.add(text);return true}).slice(0,limit);
}
