import {describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {runClaudeJson} from '../src/ai/claude-json.js';
import {generationConfig} from '../src/ai/config.js';
import {createClaudeGenerator} from '../src/quiz-generation/claude.js';
import {createQAClaudeGenerator} from '../src/qa/generate.js';
import type {Passage} from '../src/qa/types.js';
const schema={type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false} as const;
function transport(value:unknown,stop='end_turn') {
 return vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify({id:'msg_test',type:'message',role:'assistant',model:'claude-sonnet-5-5',content:[{type:'text',text:JSON.stringify(value)}],stop_reason:stop,stop_sequence:null,usage:{input_tokens:50,output_tokens:50}}),{status:200,headers:{'content-type':'application/json'}}));
}
describe('Claude 공식 SDK 어댑터 (외부 HTTP는 테스트 대역)',()=> {
 it('구조화 출력으로 퀴즈를 생성하고 서버의 문항·출처 검증을 적용한다',async()=> {
  const question={prompt:'정규화의 목적은 무엇인가요?',options:['중복 감소','중복 증가','자료 삭제','정렬'],correct_index:0,explanation:'정규화는 중복을 줄입니다.',slide_nos:[2]};
  const http=transport({questions:[question]});const generate=createClaudeGenerator({apiKey:'test-only-key',transport:http});
  const result=await generate([{slide_no:2,text:'정규화는 데이터 중복을 줄인다.'}],1);
  expect(result).toHaveLength(1);expect(result[0].slide_nos).toEqual([2]);expect(http).toHaveBeenCalledTimes(1);
  const body=JSON.parse(String(http.mock.calls[0][1]?.body));expect(body.output_config.format.type).toBe('json_schema');expect(body.model).toBe('claude-sonnet-5-5');expect(body.tools).toBeUndefined();
  const invalid=createClaudeGenerator({apiKey:'test-only-key',transport:transport({questions:[{...question,slide_nos:[9]}]})});
  await expect(invalid([{slide_no:2,text:'정규화'}],1)).rejects.toMatchObject({code:'INVALID_AI_RESPONSE'});
 });
 it('Q&A도 Claude를 사용하며 검색 결과 밖의 출처와 보완 질문의 출처를 거부한다',async()=> {
  const source={material_id:randomUUID(),chunk_id:randomUUID(),source_type:'document' as const,slide_no:2,start_sec:null,end_sec:null};
  const passages:Passage[]=[{source,text:'정규화는 중복을 줄인다.',score:1}];
  const good=createQAClaudeGenerator({apiKey:'test-only-key',transport:transport({text:'정규화는 중복을 줄입니다.',source_ids:[source.chunk_id]})});
  expect((await good({messages:[],passages,mode:'answer'})).source_ids).toEqual([source.chunk_id]);
  const bad=createQAClaudeGenerator({apiKey:'test-only-key',transport:transport({text:'이 출처는 검색 결과에 없습니다.',source_ids:[randomUUID()]})});
  await expect(bad({messages:[],passages,mode:'answer'})).rejects.toMatchObject({code:'INVALID_QA_SOURCE'});
  await expect(good({messages:[],passages,mode:'clarification'})).rejects.toMatchObject({code:'INVALID_QA_SOURCE'});
 });
 it('잘린 응답·거절을 완성된 답변으로 취급하지 않는다',async()=> {
  for(const stop of ['max_tokens','refusal'])await expect(runClaudeJson('input',schema,{apiKey:'test-only-key',transport:transport({ok:true},stop)})).rejects.toMatchObject({code:'INCOMPLETE_AI_RESPONSE'});
 });
 it('키 누락과 인증·한도 오류를 구분하고 SDK 원문을 노출하거나 자동 재시도하지 않는다',async()=> {
  await expect(runClaudeJson('input',schema,{})).rejects.toMatchObject({code:'AI_NOT_CONFIGURED'});
  for(const [status,code] of [[401,'AI_AUTH_FAILED'],[429,'AI_LIMIT'],[400,'AI_REQUEST_REJECTED']] as const) {
   const http=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({type:'error',error:{type:'authentication_error',message:'private-input-should-not-leak'}}),{status,headers:{'content-type':'application/json'}}));
   try{await runClaudeJson('input',schema,{apiKey:'test-only-key',transport:http});expect.fail('expected rejection')}catch(error){expect(error).toMatchObject({code});expect(String(error)).not.toContain('private-input-should-not-leak')}
   expect(http).toHaveBeenCalledTimes(1);
  }
 });
 it('서버와 실제 검증 스크립트가 같은 제공자 설정을 사용한다',()=> {
  expect(generationConfig({ANTHROPIC_API_KEY:'claude-only',OPENAI_API_KEY:'other'})).toMatchObject({provider:'claude',apiKey:'claude-only'});
  expect(generationConfig({AI_PROVIDER:'codex',ANTHROPIC_API_KEY:'ignored',CODEX_MODEL:'custom'})).toMatchObject({provider:'codex',apiKey:undefined,model:'custom'});
  expect(()=>generationConfig({AI_PROVIDER:'unknown'})).toThrow();
 });
});
