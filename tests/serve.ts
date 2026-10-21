/** 브라우저 통합 테스트 전용 서버. 일반 실행 경로에는 테스트 생성기를 넣지 않는다. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../backend/src/app.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import type {Decision} from '../backend/src/qa/types.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const dataDir=mkdtempSync(resolve(tmpdir(),'campus-e2e-'));
const service=createApp({root,dataDir,demoAuth:true,qaJudge:async input=>{const clear=!input.messages[0]?.text.includes('모호');const enough=!input.messages[0]?.text.includes('자료에 없는');return {model:'jev-test-double',clarity:{label:clear?'clear':'unclear',confidence:.99,probabilities:{clear:clear?.99:.01,unclear:clear?.01:.99}},evidence:{label:enough?'sufficient':'insufficient',confidence:.99,probabilities:{sufficient:enough?.99:.01,insufficient:enough?.01:.99}}} satisfies Decision},qaGenerator:async input=>input.mode==='clarification'?{text:'어떤 강의 개념을 질문하시는지 한 번만 더 알려 주세요.',source_ids:[]}:{text:'정규화는 데이터 중복을 줄이는 과정입니다.',source_ids:input.passages.slice(0,1).map(p=>p.source.chunk_id)},generator:async(slides,count,previous=[])=>Array.from({length:count},(_,i)=>({prompt:`데이터 중복을 줄이기 위한 개념은 무엇인가요? (${previous.length+i+1})`,options:['정규화','무작위 복제','원본 삭제','중복 저장'],correct_index:0,explanation:'정규화는 관계형 데이터베이스에서 데이터 중복을 줄이는 설계 과정입니다.',slide_nos:[slides[0].slide_no]}))});
const server=service.app.listen(3100,'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>void service.close().then(()=>{rmSync(dataDir,{recursive:true,force:true});process.exit(0)})));
