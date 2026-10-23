# 구현 현황

2026-10-23 기준. 전체 목표 아키텍처와 현재 구현을 구분한다. 팀원 접속·테스트는 README, 다음 개발자 인계는 [team-handoff.md](team-handoff.md)를 따른다.

| 구성 | 현재 구현 | 다음 단계 |
| --- | --- | --- |
| 웹 | React·Vite·TypeScript, 실제 로그인/초대 가입·강의 생성·팀원 초대, 교수/학생 퀴즈·Q&A·PDF, 외부 HTTPS 검증 | 팀원 역할별 리허설·사용성 보완 |
| API | Express, 강의별 권한, 비공개 자료, 선택 게시, 서버 채점, 개인 결과 | 실제 강의 관리 |
| 자료 처리 | Python 별도 프로세스, PDF(pypdf)·PPTX(OOXML), 페이지 순서·범위 보존 | Docling/OCR·벡터 색인 |
| 모델 | 기본 Claude API(퀴즈·Q&A), 선택적 Codex CLI 및 이전 퀴즈용 OpenAI·Gemini 어댑터 | 배포 환경의 운영·예산 관리 |
| Q&A 판단 | 공식 TypeSafe SDK Jev 어댑터·단어 검색·추가 질문 1회·교수 답변 | 한국어 경계 사례 확장 평가·벡터 검색 |
| 인증 | 이메일·비밀번호(scrypt), 서버 세션, 단일 사용 초대, 강의 권한 검사 | 학교 SSO·이메일 인증/재설정 |
| 저장 | MySQL 8.4·번호별 마이그레이션·비공개 영구 파일 볼륨. SQLite는 로컬 체험용 유지 | 원격 백업·복구 검증 |
| 작업 | DB 상태 저장·비동기 처리, 재시작 시 중단 작업 실패 표시 | 다중 Worker의 lease·재확보·재시도 |

사용자 결정으로 Supabase 대신 MySQL을 사용한다. `ENABLE_DEMO_AUTH=false`와 `MYSQL_URL`로 실제 계정 모드를 실행한다. Oracle Ubuntu 22.04 ARM64 서버에서 실제 배포·Claude/Jev·전사·운영 브라우저·컨테이너 교체·백업을 확인했다. 최초 검증은 SSH TLS 터널을 사용했고 OCI 443 수신 규칙 수정 후 외부 HTTPS API와 브라우저 로그인·저장된 오답/Q&A·교수/학생 PDF·학생 격리도 확인했다. 모델 호출은 서버 코드의 생성 함수로 분리해 사용한다. 실행 코드에 테스트 대역으로 자동 대체하는 경로는 없다.

## 구현 계약

계약 버전은 `0.11.0-mysql-auth.1`이다. `openapi.yaml`에서 `x-implementation-status`로 구현된 API와 후속 계획 API를 구분한다. 개발은 campus_session, HTTPS 배포는 __Host-campus_session 서버 세션 쿠키를 사용한다. JWT·Supabase Auth는 사용하지 않는다.

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

화면은 교수 전용 수업 레포트 탭이며 주차 선택·전체 선택·문항별 정답과 풀이·Q&A 대화·오류 상태를 제공한다. AI를 다시 호출하지 않는다. 수강 이력 스냅샷·AI 서술형 요약은 미구현이며 PDF 다운로드는 아래 후속 구현을 따른다. [기준과 API](reports.md)를 따른다.

## 녹음·동영상 전사

교수의 주차별 업로드를 디스크에 저장한 뒤 MediaService가 한 파일씩 자동 전사한다. ffprobe/ffmpeg로 로컬 입력·트랙·길이를 검사하고 Python faster-whisper small·CPU int8을 실행한다. 모델·시간 형식·무음·파일 오류는 실패로 저장하며 원본을 보존하고 명시적 재시도를 제공한다.

기존 문서는 source_type이 없어도 document로 해석한다. 완료된 전사만 같은 강의·주차의 단어 검색에 포함하고 인접 구간을 1,000자·60초 안에서 묶는다. 문서 페이지와 전사 시간은 타입·계약으로 구분한다. Q&A·레포트는 시간 출처를 보여주고 권한이 있을 때만 재생기를 제공한다. 원본 비공개와 Q&A 처리 허용을 분리한다.

현재 전사는 로컬 프로세스 직렬 처리이며 Supabase 큐·lease·다중 서버를 구현한 것은 아니다. 기본 설정·크기·시간·정확도 제약은 [미디어 명세](media.md)를 따른다.

## YouTube 링크 수집

같은 교수 화면에서 YouTube 링크와 선택 시간을 등록하면 기존 MediaService 직렬 큐에 source_type=video 및 youtube 메타데이터로 저장한다. Python은 고정한 영상 ID의 메타데이터를 검사하고 youtube-transcript-api로 자막을 먼저 가져온다. 자막을 가져올 수 없으면 yt-dlp로 최대 500MB 음성을 임시 다운로드하고 선택 구간을 faster-whisper로 전사한다. 원본 전체 길이는 120분 이하여야 한다.

링크의 t/start 시각과 선택 범위를 보존하며 ASR의 상대 시간을 원본 절대 시간으로 환산한다. 완료 전/실패 자료와 범위 밖 결과는 검색하지 않는다. Source.origin=youtube를 Q&A·레포트에 보존하고, 비공개 학생에게 영상 ID/URL을 반환하지 않는다. 권한 있는 원본 재생은 앱의 playback/original에서 302로 정규 YouTube 시작 시각에 이동한다. 파일 재생·Range와 구분한다.

yt-dlp는 선택한 고정 URL과 Node 런타임을 사용하며 사용자 URL을 셸에 넘기지 않는다. 쿠키/계정/프록시로 제한을 우회하지 않는다. 실제 수집·ASR과 자동 검사 대역은 [검증 기록](verification.md), 의존성·전체 제한은 [YouTube 명세](youtube.md)를 따른다. Supabase 큐 계약을 구현한 것은 아니다.

## YouTube 퀴즈

완료된 YouTube 자료의 선택 구간을 materialPassages로 청크화하고, transcript.ts가 전체 근거를 그룹/배치로 Claude 또는 명시적 Codex에 전달한다. 응답의 source_ids를 검증한 뒤 서버가 실제 시간 Source로 연결한다. 기존 문서용 slide_nos 생성 경로는 유지한다. 로컬 파일 미디어의 퀴즈 출제는 아직 지원하지 않는다.

근거 부족·형식/출처 오류·중복·후속 배치 실패는 Job 오류로 남기고 부분 초안을 만들지 않는다. 교수 검토/선택 게시·학생 서버 채점·개인 오답·레포트는 기존 데이터를 재사용하며 공용 Source 타입을 확장했다. 페이지/시간을 구분하는 출처 컴포넌트를 교수 검토·학생 오답·문항별 레포트에도 사용한다. 모델 지침과 구조/출처 검사는 내용의 정답을 보증하지 않는다.


## 교수 초안 직접 수정

API 0.10.0-student-report.1에서 교수는 미게시 문항의 문제·보기·정답·풀이를 직접 수정한다. 문항·보기 ID/순서와 출처는 보존하고 입력을 검증한다. 전체 초안 버전과 중복 요청 키로 저장/게시를 보호하며 버전 없는 기존 데이터는 1로 읽는다. 게시 후에는 초안을 잠그고 게시 당시 값으로 채점·오답·레포트를 제공한다.

편집 중 저장/취소 전에는 화면 이동·게시를 막고 저장 오류는 입력을 보존한다. 충돌한 초안은 사용자가 입력을 취소한 뒤 최신본을 불러온다. 수동 수정에 생성 모델·Jev API를 호출하지 않는다. [사용법과 계약](draft-edit.md)을 따른다.


## 교수 PDF 다운로드

API 0.10.0-student-report.1의 교수 전용 reports/pdf는 선택 주차의 퀴즈와 Q&A 전체 대화를 하나의 DB 스냅샷으로 묶고 ReportLab CLI로 PDF를 만든다. 화면의 Q&A 페이지 제한을 적용하지 않는다. B 화면의 다운로드 버튼·진행/오류 안내와 한글/수학 글꼴을 추가했다. 기존 통계/교수 권한·개인 격리를 재사용하며 모델을 호출하지 않는다. 명시적 크기/시간/동시성 한도·설치·문서 내용은 [레포트 명세](reports.md#pdf-다운로드)를 따른다.


## 학생 개인 오답 PDF

API 0.10.0-student-report.1은 학생 전용 wrong-answers JSON/PDF를 제공한다. 서버 세션의 학생·강의·선택 주차로 본인의 저장 제출을 제한하고 오답 스냅샷만 직렬화한다. 미응시/모두 정답을 구분하며 PDF에 내 선택·정답·풀이·페이지/시간 출처를 담는다. 기존 ReportLab 레이아웃·글꼴·실행/크기/동시성 제한을 공유하며 학생 머리글·페이지 번호·개인 요약을 사용한다. 교수 다운로드와 학생 다운로드는 공용 프런트엔드 훅으로 진행/오류/중단을 처리한다. [명세](reports.md#학생-개인-오답-레포트)를 따른다.

## MySQL 실제 계정과 배포 구성

API 0.11.0-mysql-auth.1에서 이메일·비밀번호 로그인, 서버 bootstrap 교수 계정, 초대 가입/강의 참여, 교수·학생 초대 발급, 교수의 강의 생성/참여자 조회를 구현했다. MySQL migrations·연결 풀·동일 연결 트랜잭션·커밋 후 작업 실행을 연결하고 자료·퀴즈·답안·Q&A·레포트의 SQL을 비동기로 전환했다. SQLite는 체험 및 기존 회귀 검사에만 유지한다.

Oracle Ubuntu용 Docker·Compose·Caddy HTTPS·비공개 영구 볼륨·SSH 배포/백업 스크립트를 추가했다. 배포 모드에서는 SQLite·체험 로그인·HTTP APP_ORIGIN을 거부한다. 현재 앱 큐는 한 프로세스이므로 MySQL runtime lock으로 중복 실행을 막는다. 학교 SSO·이메일 인증/재설정·자동 다중 Worker 복구·원격 백업 검증은 포함하지 않는다. [운영/설정 안내](deployment.md)를 따른다. 원격 서버 검증은 로컬 MySQL·자동 검사 성공과 별도로 기록한다.
