# 다음 개발자 인계

2026-10-23 기준. 개발 마감은 2026-10-31이며 팀은 4명이다. 이 문서가 포함된 `main`을 다음 개발의 기준으로 사용한다. 팀원 가입과 교수 1명·학생 3명의 테스트 순서는 [README](../README.md#실제-계정과-팀원-테스트)에 있다.

## 현재 동작과 운영 상태

- 사이트: https://campus.146.56.101.124.sslip.io
- Oracle Ubuntu 22.04 ARM64 서버에서 앱·MySQL 8.4·Caddy HTTPS를 실행한다. 운영 생성 제공자는 Claude API이며 Q&A 판단은 TypeSafe Jev다.
- PDF/PPTX·YouTube 기반 퀴즈 생성, 교수 문제/보기/정답/풀이 수정·게시, 학생 풀이·개인 오답, 자료 기반 Q&A·보완 질문 1회·교수 승격/답변, 주차별 교수/학생 PDF를 구현했다. 녹음·영상 전사와 시간 출처도 제공한다.
- 실제 Claude 5문항 생성·수정·게시·채점, 실제 Jev 분기·교수 답변, ARM64 Whisper 전사, 컨테이너 교체 후 기록 보존과 DB/파일 백업을 검증했다. 외부 HTTPS의 교수/학생 로그인·저장된 오답/Q&A·PDF·학생 격리·모바일 검사도 통과했다. 상세 조건과 한계는 [검증 기록](verification.md)에 있다.
- 서버에서 검증한 릴리스는 `c145dfb`다. 이후 변경은 접속·검증·인계 문서이며 `main` 병합 자체는 서버 자동 배포를 실행하지 않는다. 다음 배포 전 현재 서버의 `~/campus-lms/current`와 Git 커밋을 확인한다.
- 기존 합성 검증 강의에는 자동 검증 계정/기록이 있다. 팀원만의 참여율을 확인하려면 새 강의를 만들고 초대한다. 실제 강의 원본과 기존 로컬 SQLite 기록은 운영 서버로 자동 복사하지 않았다.

## 개발 시작 순서

1. `git switch main`과 `git pull --ff-only origin main`으로 최신 코드를 받는다. 로컬 수정이 있다면 먼저 별도 브랜치에 보존한다.
2. `AGENTS.md`, 이 문서, 담당 GitHub 이슈와 [구현 현황](implementation.md)을 읽는다. 이전 날짜의 Supabase·Gemini·미배포 설명은 당시 기록이며 현재 기준은 MySQL·Claude·Oracle다.
3. 담당 이슈에 자신의 GitHub 계정·역할·수정 범위·의존 작업·다음 할 일을 기록한다. 새 작업은 `feat/<role>-<issue>-<topic>` 브랜치에서 진행한다.
4. [README 로컬 실행](../README.md#로컬-실행)으로 Node 24.13 이상·Python 가상 환경·의존성을 준비한다. `.env.example`을 `.env`로 복사해 자신의 설정을 입력한다. `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY`와 운영 접근 정보는 Eddy에게 별도 전달받는다.
5. 담당 기능과 관련 검사를 실행하고 명령·실제 결과·남은 제약을 PR에 기록한다. 다른 AI가 이슈 글을 자동으로 읽거나 작업을 시작한다고 가정하지 않는다.

| 개발 담당 | 우선 확인할 범위 |
| --- | --- |
| A 플랫폼·통합 | `mysql/`, `backend/src/auth/`, `backend/src/courses/`, `backend/src/reports/`, 계약·배포·통계 분모 |
| B 웹 | `frontend/`, 가입·강의 선택·교수/학생 화면·모바일·오류 안내·PDF 다운로드 |
| C 자료·퀴즈 | `worker/`, `backend/src/quiz-generation/`, 페이지/시간 출처·자료 처리·문제 생성/수정/게시 |
| D Q&A·Jev | `backend/src/qa/`, `backend/src/retrieval/`, 근거 검색·판단·보완 질문 1회·교수 승격·오류/재시도 |

공용 API는 `docs/contracts/openapi.yaml`의 `0.11.0-mysql-auth.1`, 향후 Worker 큐 계약은 `draft-1`이다. 필드 변경은 계약·샘플·서버·화면을 함께 수정한다. 현재 자료 처리는 별도 Python 프로세스이며 검색은 단어 기반이다. 분산 작업 큐·벡터 검색이 이미 구현됐다고 가정하지 않는다.

## 검사와 다음 우선순위

기본 검사는 `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `python scripts/check_contracts.py`다. Python 가상 환경에 `worker/requirements.txt`와 `requirements-contracts.txt`를 설치한다. MySQL 검사는 폐기 가능한 `campus_test` DB와 `MYSQL_TEST_URL`을 준비한 뒤 서버 검사와 `npm run test:e2e:mysql`을 실행한다. 운영 DB를 테스트 URL로 사용하지 않는다. CI의 App·Contracts·Container가 실제 MySQL/브라우저/컨테이너 검사를 수행하며 최신 커밋 결과는 GitHub Actions에서 확인한다.

다음 담당은 먼저 팀원의 역할별 리허설 결과를 GitHub 이슈에 모으고 재현되는 오류부터 수정한다. 이후 실제 한국어 강의의 퀴즈 품질·Jev의 모호/근거 부족 경계 사례, 긴 녹음/영상의 처리 시간과 모델 비용을 확인한다. 백업 파일 생성·검사는 완료했지만 복구 훈련과 자동 원격 백업은 남아 있다. 학교 SSO·이메일 인증/비밀번호 재설정, 다중 Worker 자동 복구, OCR·벡터 검색은 후속 범위다. 전체 통합 이슈 #6은 팀원 리허설·최종 제출 확인까지 `in_progress`로 유지한다.

## 운영 접근과 재배포

관리자 로그인 정보·개인별 초대 코드는 Eddy가 비공개로 관리한다. GitHub에는 값을 저장하지 않는다. 교수는 화면에서 새 초대 코드를 발급할 수 있다. API 키, MySQL 비밀번호, `.env.production`, SSH 개인키, DB 백업과 실제 학생 자료는 필요한 담당에게 별도 전달한다.

운영 절차는 [deployment.md](deployment.md)와 `scripts/deploy-oracle.sh`, `deploy/backup.sh`를 따른다. 릴리스 경로는 `~/campus-lms/releases/<commit>`, 현재 링크는 `~/campus-lms/current`다. 배포는 Git에 커밋한 파일과 비공개 환경 파일을 따로 전송한다. 같은 MySQL 비밀번호·Compose 프로젝트·영구 볼륨을 유지하고 앱은 한 프로세스만 실행한다. `docker compose down -v`는 사용하지 않는다. 코드 병합, 서버 배포, 팀원 리허설 결과는 각각 구분해 기록한다.
