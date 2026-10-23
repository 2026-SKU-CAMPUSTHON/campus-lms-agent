# Campus LMS Agent 작업 지침

이 저장소는 2026-10-31 마감의 4인 프로젝트다. 기획은 `docs/product.md`, 기술 기준은 `docs/architecture.md`, 우선순위는 GitHub 이슈에 있다. PDF/PPTX 퀴즈 첫 기능은 로컬에서 구현되어 있다. Q&A의 Jev 어댑터·추가 질문 1회·교수 답변도 로컬에서 구현했다. 실제 Claude·Jev 흐름도 소수 사례로 확인했다. 교수 주차별 레포트와 녹음·동영상 자동 전사·시간 출처도 로컬에서 구현했다. YouTube 공개 영상의 자막 우선 수집·음성 전사 대체·선택 구간·시간 출처도 구현했다. 같은 YouTube 자료의 퀴즈 생성·검토·선택 게시·학생 오답에도 시간 출처를 보존한다. 교수의 미게시 문제·보기·정답·풀이 직접 수정, 버전 확인 저장·게시도 지원한다. 선택 주차의 퀴즈·Q&A 전체 대화를 교수 전용 PDF로 다운로드한다. 학생도 본인의 제출 결과 중 오답·선택 답·정답·풀이를 강의 주차별로 조회/PDF 다운로드한다. 사용자 결정으로 Supabase 대신 MySQL 8.4·서버 세션 인증을 사용한다. 실제 MySQL 로컬 검증과 Oracle 원격 배포 상태는 docs/verification.md를 구분해서 따른다. 구현 현황은 docs/implementation.md를 따른다. 사용자가 명시한 최신 요구를 우선한다.

## 시작과 인계

- 작업 시작·작업 전환·PR 제출 전에 이슈, 관련 PR, 최신 공용 계약을 읽는다.
- 본인에게 주어진 역할과 담당 이슈를 확인한다. 다른 AI가 맡은 작업을 중복 수행하지 않는다. 역할만 정해졌고 계정 배정이 없으면 작업 이슈에 자신의 담당을 기록한다.
- 이슈 본문의 `status`를 `ready / in_progress / blocked / review / done`으로 관리한다. GitHub open/closed 상태와 구분한다. `done`은 구현·검증·병합 후에만 사용한다.
- 이슈에 의존 작업, 변경 범위, 계약 버전, 차단 원인, 관련 PR, 다음 담당을 남긴다. AI가 GitHub 글을 자동으로 즉시 읽는다고 가정하지 않는다.
- 작업별 브랜치 `feat/<role>-<issue>-<topic>`에서 구현한다. main에 직접 구현을 밀어 넣지 않는다. 저장소 최초 문서 구성은 예외다.

## 역할과 수정 범위

- A 플랫폼·통합: `mysql/`, `backend/src/auth/`, `backend/src/courses/`, `backend/src/reports/`, 공용 설정·배포·계약 통합.
- B 웹: `frontend/`. 확정 전에는 계약 샘플을 사용한다.
- C 자료·퀴즈 AI: `worker/`, `backend/src/quiz-generation/`, 자료 색인 모듈.
- D Q&A·Jev: `backend/src/qa/`, `backend/src/retrieval/`, Q&A 평가 자료.
- 위 앱 경로는 만들 구조에 대한 합의안이다. Quizify 검증 후 첫 계약 PR에서 확정한다. 한 AI가 다른 담당 소유 파일을 수정해야 하면 영향과 이유를 해당 이슈에서 먼저 공유한다.
- A가 OpenAPI와 DB 마이그레이션을 최종 통합한다. C와 D가 같은 RAG 파일을 동시에 수정하지 않도록 색인·검색을 분리한다.

## 고정할 동작

- 하나의 사이트에서 강의별 교수·학생 권한을 제공한다. UI 숨김 외에 서버와 DB 권한을 검사한다.
- 원본 비공개와 AI 처리 허용은 별개다. 다른 강의 자료·개인 답안·대화는 조회할 수 없어야 한다.
- 문서 페이지는 1부터, 전사 시간은 초 단위다. 로컬 전사·공개 여부·재시도 규칙은 docs/media.md를 따른다. 출처와 주차를 보존한다. 구형 `.ppt` 변환은 별도 검토다.
- 퀴즈 초안과 게시 문항을 구분한다. 제출 전 학생 응답에는 정답·해설을 포함하지 않는다. 채점은 서버가 수행한다.
- Jev는 검색 후 질문 명확성과 근거 충분성을 판단한다. 생성 제공자는 사용자 요청에 따라 기본 Claude API다. 명시적 Codex 선택도 가능하며 OpenAI/Gemini는 이전 퀴즈 전용 어댑터다. 서버가 추가 질문 1회 제한과 상태 전환을 수행한다.
- 학생 보완 답변 후에는 재검색·재판단한다. 여전히 모호하거나 근거가 부족하면 교수님에게 승격한다.
- API 오류와 답변 근거 부족은 다르다. 오류는 별도 기록·재시도 경로로 처리한다. Jev 확률을 정답 확률로 설명하지 않는다.
- 통계는 SQL/코드로 계산한다. 분모·재응시 규칙은 docs/reports.md와 API 계약을 따른다. 현재 수강생·게시 퀴즈 제출·고유 참여자·가중 정답률을 사용하며 수강 이력 스냅샷은 없다.

## 계약·재사용·검증

- API: `docs/contracts/openapi.yaml` (JSON으로 작성한 유효 YAML). Worker: `docs/contracts/worker.schema.json`. 변경은 계약·샘플·사용처를 함께 갱신한다.
- 현재 API 계약은 0.11.0-mysql-auth.1이며 Worker 큐 계약은 draft-1이다. 새 필드를 몰래 추가하거나 불일치를 타입 캐스팅으로 숨기지 않는다.
- Quizify는 재사용 후보이며 아직 벤더링하지 않았다. 코드를 가져오면 해당 MIT 원문·저작권 고지를 유지하고 기준 커밋을 남긴다.
- 비밀키·실제 학생 자료·로컬 개인 설정은 커밋하지 않는다. `.env.example`에는 키 이름만 둔다.
- Node 24.13 이상·Python 3.9 이상. 앱 검증: `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`. Worker PDF 의존성: `worker/requirements.txt`. 실제 모델을 호출하는 검증은 `node --import tsx scripts/verify-live-flow.ts <자료 경로> [문항 수] [시작] [끝]`이며 계정 사용 한도에 영향을 준다.
- 로컬 체험 모드는 개발용이며 기본 `AI_PROVIDER=claude`는 Anthropic API 키가 필요하다. `AI_PROVIDER=codex`는 선택적인 로컬 로그인 모드다. 실제 배포는 MySQL·HTTPS APP_ORIGIN·ENABLE_DEMO_AUTH=false와 영구 파일 볼륨을 요구한다. docs/deployment.md와 Oracle 서버 설정을 따른다. CLI에 학생 입력을 셸 명령으로 전달하거나 위험 우회 플래그를 사용하지 않는다.
- 계약 검증 명령: `python -m pip install -r requirements-contracts.txt`, `python scripts/check_contracts.py`.
- 구현 PR에서는 해당 변경의 실행 명령과 실제 결과를 기록한다. 실행하지 않은 검사·모델 평가·배포를 완료라고 쓰지 않는다. 초기 계약 검증 통과를 앱 완성으로 취급하지 않는다.
