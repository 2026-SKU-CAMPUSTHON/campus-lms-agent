# 첫 기능 구현 현황

2026-10-21 기준. 전체 목표 아키텍처와 현재 구현을 구분한다.

| 구성 | 현재 구현 | 다음 단계 |
| --- | --- | --- |
| 웹 | React·Vite·TypeScript, 한 사이트에서 교수/학생 화면 | Q&A·레포트 화면 |
| API | Express, 강의별 권한, 비공개 자료, 선택 게시, 서버 채점, 개인 결과 | 실제 강의 관리·레포트·Q&A |
| 자료 처리 | Python 별도 프로세스, PDF(pypdf)·PPTX(OOXML), 페이지 순서·범위 보존 | Docling/OCR·녹음 전사·검색 색인 |
| 모델 | 기본 Codex CLI 로컬 로그인, OpenAI Responses API·Gemini 어댑터 | 배포 환경의 API 자격 증명과 실제 호출 검증 |
| Q&A 판단 | Jev의 역할·상태 계약만 존재 | 검색 뒤 명확성·근거 판단, 추가 질문 1회·승격 |
| 인증 | 서버 세션·체험 계정, 강의 권한 검증, 로컬 주소 제한 | Supabase Auth JWT·실제 수강생 관리 |
| 저장 | 로컬 SQLite·비공개 파일 디렉터리, 재시작 보존 | Supabase PostgreSQL/Storage·RLS |
| 작업 | DB 상태 저장·비동기 처리, 재시작 시 중단 작업 실패 표시 | 다중 Worker의 lease·재확보·재시도 |

Supabase 설정이 없어 첫 기능은 로컬 SQLite 저장 어댑터로 실행한다. 실제 학생 대상 배포가 가능하다는 뜻이 아니다. 모델 호출은 서버 코드의 생성 함수로 분리해 사용한다. 실행 코드에 테스트 대역으로 자동 대체하는 경로는 없다.

## 구현 계약

계약 버전은 `0.2.0-quiz.1`이다. `openapi.yaml`에서 `x-implementation-status`로 구현된 API와 후속 계획 API를 구분한다. 구현된 로컬 API는 세션 쿠키를 사용하고, 후속 Supabase API는 JWT 설계로 남긴다.

Worker JSON 스키마 draft-1은 향후 작업 큐 통합 계약이다. 현재 CLI 프로세스는 `document_extract.py <파일> <시작> <끝>`으로 `{total_slides, slides:[{slide_no,text}]}`를 반환한다. 장기 키·서명 URL은 결과에 포함하지 않는다.

교수 입력 오류·키/로그인 미설정·모델 오류·출처 범위 오류는 실패로 반환한다. 모델 실패를 정상 문제나 교수님 승격으로 바꾸지 않는다. Jev의 후속 분기에는 별도 구현이 필요하다.

## Quizify 재사용 판단

자료 등록·검토·게시·서버 채점의 흐름을 코드 수준에서 참고했다. 기존 저장소는 이메일 도메인·공개 공유 토큰·Supabase 스키마·다른 생성 제공자에 결합되어 있다. 첫 기능에는 해당 앱 전체를 벤더링하지 않았다. 현재 구현은 React/Vite/Express와 공식 모델 SDK·pypdf를 연결한 별도 모듈이다.

Quizify 소스는 임시 폴더에서 검토했으며 의존성 설치·실제 Supabase 실행은 하지 않았다. 따라서 기존 제품의 전체 실행 검증 완료로 보고하지 않는다. 향후 재사용하는 파일이 생기면 기준 커밋과 MIT 저작권 고지를 함께 기록한다.

## 참고 문서

- [Codex 비대화형 실행·JSON Schema 출력](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex 인증·프로그램 실행 시 API 키 권장](https://learn.chatgpt.com/docs/auth)
- [OpenAI 구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Gemini 구조화 출력](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
