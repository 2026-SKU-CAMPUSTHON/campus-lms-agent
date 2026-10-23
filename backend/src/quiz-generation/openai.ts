import OpenAI from 'openai';
import { HttpError } from '../errors.js';
import { validateQuestions, type Generator } from './questions.js';
import { prompt, questionSchema } from './prompt.js';
export function createOpenAIGenerator(apiKey:string|undefined,model:string):Generator {
  return async(slides,count,previous=[])=> {
    if(!apiKey)throw new HttpError(503,'AI_NOT_CONFIGURED','OpenAI API 키가 설정되지 않았습니다. 서버 .env의 OPENAI_API_KEY를 설정해 주세요.');
    try {
      const client=new OpenAI({apiKey,timeout:90000,maxRetries:0});
      const response=await client.responses.create({model,store:false,input:prompt(slides,count,previous),text:{format:{type:'json_schema',name:'concept_quiz',strict:true,schema:questionSchema(count)}},max_output_tokens:16000});
      if(response.status!=='completed')throw new HttpError(502,'INCOMPLETE_AI_RESPONSE','GPT의 문제 생성이 완료되지 않았습니다. 범위나 문항 수를 줄여 주세요.',true);
      return validateQuestions(JSON.parse(response.output_text),slides,count);
    } catch(error) {
      if(error instanceof HttpError)throw error;
      throw new HttpError(502,'AI_GENERATION_FAILED','GPT 문제 생성에 실패했습니다. OpenAI API 키·사용 한도·모델 설정을 확인해 주세요.',true);
    }
  };
}
