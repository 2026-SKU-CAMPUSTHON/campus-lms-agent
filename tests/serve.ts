/** 브라우저 통합 테스트 전용 서버. 일반 실행 경로에는 테스트 생성기를 넣지 않는다. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../backend/src/app.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const service=createApp({root,dataDir:resolve(root,'.data/e2e'),demoAuth:true,generator:async(slides,count,previous=[])=>Array.from({length:count},(_,i)=>({prompt:`데이터 중복을 줄이기 위한 개념은 무엇인가요? (${previous.length+i+1})`,options:['정규화','무작위 복제','원본 삭제','중복 저장'],correct_index:0,explanation:'정규화는 관계형 데이터베이스에서 데이터 중복을 줄이는 설계 과정입니다.',slide_nos:[slides[0].slide_no]}))});
const server=service.app.listen(3000,'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>void service.close().then(()=>process.exit(0))));
