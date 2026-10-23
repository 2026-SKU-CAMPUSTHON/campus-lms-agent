import { z } from 'zod';
import { HttpError } from '../errors.js';
import type { GeneratedQuestion, Slide } from '../types.js';
export type Generator = (slides:Slide[], count:number, previous?:string[]) => Promise<GeneratedQuestion[]>;
const questionSchema=z.object({prompt:z.string().trim().min(5).max(2000),options:z.array(z.string().trim().min(1).max(1000)).length(4),correct_index:z.number().int().min(0).max(3),explanation:z.string().trim().min(5).max(4000),slide_nos:z.array(z.number().int().positive()).min(1)}).strict();
const responseSchema=z.object({questions:z.array(questionSchema).min(1).max(8)}).strict();
export function validateQuestions(raw:unknown,slides:Slide[],count:number):GeneratedQuestion[] {
  const parsed=responseSchema.safeParse(raw);
  if(!parsed.success || parsed.data.questions.length!==count) throw new HttpError(502,'INVALID_AI_RESPONSE','AI 응답 형식이나 문항 수가 올바르지 않습니다. 다시 생성해 주세요.',true);
  const allowed=new Set(slides.map(s=>s.slide_no));
  for(const q of parsed.data.questions) {
    if(new Set(q.options.map(o=>o.toLocaleLowerCase())).size!==4 || q.slide_nos.some(n=>!allowed.has(n))) throw new HttpError(502,'INVALID_AI_RESPONSE','AI가 중복 보기 또는 범위 밖 출처를 반환했습니다. 다시 생성해 주세요.',true);
  }
  return parsed.data.questions;
}
export async function generateAcrossRange(slides:Slide[],count:number,generate:Generator):Promise<GeneratedQuestion[]> {
  const groups:Slide[][]=[];
  for(const slide of slides.filter(s=>s.text.trim())) {
    if(slide.text.length>18000) throw new HttpError(422,'SLIDE_TOO_LONG','한 페이지의 텍스트가 너무 깁니다. 자료를 나누어 주세요.');
    const group=groups.at(-1);
    if(!group || group.reduce((n,s)=>n+s.text.length,0)+slide.text.length>18000) groups.push([slide]); else group.push(slide);
  }
  if(!groups.length || groups.length>count) throw new HttpError(422,'RANGE_TOO_LARGE','전체 범위를 반영하려면 문항 수를 늘리거나 페이지 범위를 줄여 주세요.');
  const questions:GeneratedQuestion[]=[];
  for(let i=0;i<groups.length;i++) {
    let remaining=Math.floor(count/groups.length)+(i<count%groups.length?1:0);
    while(remaining>0) {
      const batch=Math.min(8,remaining);
      // 모든 배치 결과를 서버에서 다시 검사한다. 테스트 대역도 동일한 검증을 거친다.
      questions.push(...validateQuestions({questions:await generate(groups[i],batch,questions.map(q=>q.prompt))},groups[i],batch));
      remaining-=batch;
    }
  }
  if(new Set(questions.map(q=>q.prompt.normalize('NFKC').replace(/\s+/g,'').toLocaleLowerCase())).size!==count) throw new HttpError(502,'DUPLICATE_QUESTIONS','중복 문항이 생성되었습니다. 다시 생성해 주세요.',true);
  return questions;
}
