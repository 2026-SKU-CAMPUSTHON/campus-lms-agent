# 구현 현황

2026-10-21 기준. 전체 목표 아키텍처와 현재 구현을 구분한다.

| 구성 | 현재 구현 | 다음 단계 |
| --- | --- | --- |
| 웹 | React·Vite·TypeScript, 교수/학생 화면·Q&A·주차별 레포트 | 실제 계정·강의 관리 화면 |
| API | Express, 강의별 권한, 비공개 자료, 선택 게시, 서버 채점, 개인 결과 | 실제 강의 관리 |
| 자료 처리 | Python 별도 프로세스, PDF(pypdf)·PPTX(OOXML), 페이지 순서·범위 보존 | Docling/OCR·녹음 전사·벡터 색인 |
| 모델 | 기본 Claude API(퀴즈·Q&A), 선택적 Codex CLI 및 이전 퀴즈용 OpenAI·Gemini 어댑터 | 배포 환경의 운영·예산 관리 |
| Q&A 판단 | 공식 TypeSafe SDK Jev 어댑터·단어 검색·추가 질문 1회·교수 답변 | 한국어 경계 사례 확장 평가·벡터 검색 |
| 인증 | 서버 세션·체험 계정, 강의 권한 검증, 로컬 주소 제한 | Supabase Auth JWT·실제 수강생 관리 |
| 저장 | 로컬 SQLite·비공개 파일 디렉터리, 재시작 보존 | Supabase PostgreSQL/Storage·RLS |
| 작업 | DB 상태 저장·비동기 처리, 재시작 시 중단 작업 실패 표시 | 다중 Worker의 lease·재확보·재시도 |

Supabase 설정이 없어 첫 기능은 로컬 SQLite 저장 어댑터로 실행한다. 실제 학생 대상 배포가 가능하다는 뜻이 아니다. 모델 호출은 서버 코드의 생성 함수로 분리해 사용한다. 실행 코드에 테스트 대역으로 자동 대체하는 경로는 없다.

## 구현 계약

계약 버전은 `0.4.0-reports.1`이다. `openapi.yaml`에서 `x-implementation-status`로 구현된 API와 후속 계획 API를 구분한다. 구현된 로컬 API는 세션 쿠키를 사용하고, 후속 Supabase API는 JWT 설계로 남긴다.

Worker JSON 스키마 draft-1은 향후 작업 큐 통합 계약이다. 현재 CLI 프로세스는 `document_extract.py <파일> <시작> <끝>`으로 `{total_slides, slides:[{slide_no,text}]}`를 반환한다. 장기 키·서명 URL은 결과에 포함하지 않는다.

교수 입력 오류·키/로그인 미설정·모델 오류·출처 범위 오류는 실패로 반환한다. 모델 실패를 정상 문제나 교수님 승격으로 바꾸지 않는다. Jev 키 누락과 호출 오류도 별도 오류 상태로 기록하고 명시적 재시도를 제공한다.

## 로컬 Q&A 구현

`backend/src/retrieval/local-search.ts`는 강의·주차·완료 상태·선택 페이지를 검사한 뒤 단어 기반 검색으로 최대 6개 근거를 반환한다. 현재는 임베딩이나 pgvector를 사용하지 않는다. 비공개 원본의 경로와 전체 내용은 학생 응답에 포함하지 않는다.

`backend/src/qa/jev.ts`는 TypeSafe SDK로 명확성·근거 충분성을 동시에 판단한다. 모델 버전과 선택지 확률을 교수 전용 판단 기록에 남긴다. Jev의 confidence는 정답 확률이 아니다. 임계값 0.75는 한국어 정확도 평가를 거치지 않은 임시값이다.

`service.ts`가 추가 질문 1회·재검색·교수 승격·교수 답변을 제어한다. 중복 요청 키, 버전 비교, 처리 중 변경 거부와 SQLite 저장으로 대화 중복·오래된 모델 응답 덮어쓰기를 방지한다. 재시작 시 진행 중 작업은 실패로 남기고 사용자가 재시도한다. 재시도는 대화나 추가 질문 횟수를 초기화하지 않는다.

`backend/src/ai/codex-json.ts`는 퀴즈와 Q&A의 공용 CLI 실행기다. 서버의 Anthropic·OpenAI·TypeSafe 등 API 키를 자식 프로세스 환경에서 제거하고 로컬 ChatGPT 로그인을 사용한다. 현재 Q&A는 기본 Claude API 또는 명시적으로 선택한 Codex를 사용한다. OpenAI/Gemini 전환은 퀴즈에만 적용되며 Q&A는 미지원 오류를 반환한다.

실제 강의 PDF로 Claude 퀴즈 3문항 생성·게시·채점과 실제 Jev·Claude Q&A의 답변·추가 질문 1회·교수 승격·교수 답변을 확인했다. 한국어 3개 사례의 분기 검증이며 정확도·임계값 평가 완료를 뜻하지 않는다. 자동 검사에서만 Judge/생성 함수를 주입하며 운영 기본값에는 테스트 응답 경로가 없다.

## Quizify 재사용 판단

자료 등록·검토·게시·서버 채점의 흐름을 코드 수준에서 참고했다. 기존 저장소는 이메일 도메인·공개 공유 토큰·Supabase 스키마·다른 생성 제공자에 결합되어 있다. 첫 기능에는 해당 앱 전체를 벤더링하지 않았다. 현재 구현은 React/Vite/Express와 공식 모델 SDK·pypdf를 연결한 별도 모듈이다.

Quizify 소스는 임시 폴더에서 검토했으며 의존성 설치·실제 Supabase 실행은 하지 않았다. 따라서 기존 제품의 전체 실행 검증 완료로 보고하지 않는다. 향후 재사용하는 파일이 생기면 기준 커밋과 MIT 저작권 고지를 함께 기록한다.

## 참고 문서

- [Codex 비대화형 실행·JSON Schema 출력](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex 인증·프로그램 실행 시 API 키 권장](https://learn.chatgpt.com/docs/auth)
- [OpenAI 구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Gemini 구조화 출력](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)

## Claude API 전환 (2026-10-21)

`backend/src/ai/claude-json.ts`는 공식 Anthropic SDK Messages API의 JSON Schema 출력을 사용한다. SDK가 API에 맞게 스키마를 변환하며, 서버가 원래 문항 수·형식·페이지 범위와 Q&A 출처를 다시 검사한다. 최대 출력 초과·거절·잘못된 출처는 정상 답변으로 저장하지 않는다. 요청 타임아웃은 90초이고 자동 재시도·다른 제공자 자동 전환은 없다.

`generationConfig()`를 API 서버와 실제 검증 스크립트가 함께 사용한다. 기본은 `claude`와 `ANTHROPIC_API_KEY`, 모델은 `claude-sonnet-5-5`다. 키·인증 오류와 한도 오류를 구분하고 SDK 원문을 노출하지 않는다.

[공식 Claude 구조화 출력](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) · [공식 모델 목록](https://platform.claude.com/docs/en/models/overview)

## 교수 주차별 레포트

backend/src/reports/에서 저장된 퀴즈와 Q&A를 집계한다. 현재 수강생 중 고유 제출 인원으로 참여율을 계산하고, 실제 제출 답안의 정답 수로 정답률을 계산한다. 전체 기간은 분자·분모 합산이다. Q&A는 선택 주차 전체의 현재 상태를 집계하고 대화 내역만 페이지로 나눈다. 교수 권한을 서버에서 검사하고 기존 Q&A 공개 DTO로 내부 판단을 제거한다.

화면은 교수 전용 수업 레포트 탭이며 주차 선택·전체 선택·문항별 정답과 풀이·Q&A 대화·오류 상태를 제공한다. AI를 다시 호출하지 않는다. 수강 이력 스냅샷·보고서 파일 다운로드·AI 서술형 요약은 미구현이다. [기준과 API](reports.md)를 따른다.
