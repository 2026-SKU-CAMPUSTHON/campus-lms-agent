# 서경대 Campus LMS Agent

강의 자료로 자율 학습 퀴즈와 Q&A를 제공하고, 교수님이 필요한 질문에 직접 개입하도록 돕는 프로젝트다. 교수·학생은 같은 사이트를 사용한다.

**현재: PDF/PPTX 퀴즈의 첫 기능을 로컬에서 구현했다.** 자료·페이지 범위 등록, AI 문제 생성, 교수 선택 게시, 학생 풀이, 서버 채점과 개인 오답 확인을 제공한다. 주차 Q&A, Jev 판단 어댑터, 추가 질문 1회와 교수 답변도 구현했다. 실제 Jev 호출은 TypeSafe 키가 없어 미검증이며, 레포트·Supabase 실서비스 연동은 다음 단계다.

## 로컬 실행

Node.js 24.13 이상과 Python 3.9 이상이 필요하다.

```bash
npm ci
python3 -m venv .venv-worker
source .venv-worker/bin/activate
python -m pip install -r worker/requirements.txt
cp .env.example .env
```

`.env`의 `PYTHON_BIN`을 가상 환경 Python의 절대 경로로 설정한다. 예: `<저장소 절대경로>/.venv-worker/bin/python`.

기본 생성 제공자는 **Codex CLI**다. 이 컴퓨터에서 `codex login`으로 연결한 ChatGPT 계정을 사용한다.

```bash
codex login status
npm run dev
```

[로컬 학습실](http://127.0.0.1:5173)에서 교수 체험으로 자료를 등록한다. 생성·검토·게시 후 로그아웃하고 학생 가/나로 풀이와 개인 오답을 확인한다. 첫 실행에는 데이터베이스 강의 1개와 주차 2개를 제공한다. 원본·결과는 `.data/`에 저장하고 Git에는 올리지 않는다.

Codex 모드는 **로그인한 로컬 컴퓨터에서만 사용하는 시연 방식**이다. CLI는 별도 임시 작업 폴더에서 읽기 전용·셸 및 하위 에이전트 비활성화로 JSON만 생성한다. 계정의 사용 한도에 영향을 받으며 키 없는 무제한 서비스가 아니다. 로컬 로그인은 실제 학교 계정 인증이 아니다. 서버는 `127.0.0.1`에만 바인딩한다.

## GPT API로 연결

공개 서비스 배포용 모델 연결은 `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL`을 설정한다. OpenAI Responses API의 구조화 출력을 사용한다. API 키는 서버에만 둔다. 현재 API 키를 이용한 실제 호출은 별도 검증이 필요하다.

이전 후보인 Gemini도 `AI_PROVIDER=gemini`로 선택할 수 있지만 기본값은 Codex다. Q&A 판단은 별도 TypeSafe API를 사용한다. 현재 Q&A 문장 생성은 Codex CLI 전용이다. `AI_PROVIDER` 전환은 퀴즈 생성에 적용된다. 별도의 에이전트 플랫폼을 필수로 운영하지 않는다.

## Q&A 실행과 판단 비용

`.env`에 `TYPESAFE_API_KEY`를 설정하고 서버를 다시 시작한다. 기본 `JEV_MODEL=jev-1.13.0`, `JEV_MIN_CONFIDENCE=0.75`는 한국어 평가 전의 임시 설정이다. Jev는 [공식 TypeSafe SDK](https://github.com/typesafe-ai/typesafe-sdk-js)로 질문 명확성과 검색 근거 충분성을 한 번에 판단한다. 답변과 보완 질문 문장은 Codex CLI가 생성한다.

Jev는 유료 API다. 확인일인 2026-10-21의 [공식 요금](https://docs.typesafe.ai/models)은 입력 100만 토큰당 $0.042, 출력 무료다. 무료 체험이나 크레딧 제공은 보장하지 않는다. Codex CLI도 연결한 ChatGPT 계정의 사용 한도를 따른다.

학생의 **강의 Q&A** 탭에서 질문한다. 현재는 같은 강의·주차의 완료된 PDF/PPTX 중 지정한 페이지 범위를 단어로 검색한다. 원본이 비공개여도 허용된 AI 처리는 가능하다. 벡터 검색·음성 전사는 후속 구현이다.

- 명확하고 근거가 충분하면 페이지 출처와 함께 답변한다.
- 모호하면 추가 질문을 한 번만 보낸다. 학생 답변 뒤 다시 검색·판단하며, 여전히 모호하면 교수님에게 넘긴다.
- 명확하지만 근거가 부족하거나 판단이 불확실하면 교수님에게 넘긴다. 교수님은 같은 탭의 학생 질문함에서 직접 답변한다.
- API 연결 실패는 오류로 보존하고 명시적인 재시도를 제공한다. 오류를 교수님 승격으로 바꾸지 않는다.
- 학생은 본인의 대화만 볼 수 있다. 대화·횟수·판단 기록은 재시작 후에도 보존한다.

실제 Jev 키가 없으면 `JEV_NOT_CONFIGURED` 오류로 표시한다. 실행 코드에서 다른 모델이나 테스트 응답으로 판단을 대체하지 않는다.

## 첫 기능의 범위

- PDF/PPTX 한 개의 물리 페이지 범위를 지정한다. 페이지 번호는 1부터, 양 끝을 포함한다.
- 원본 공개 여부를 별도로 정한다. 비공개 원본도 문제 생성에 사용할 수 있다.
- 문서의 실제 페이지 순서를 유지하고, 1~50개의 객관식 문제를 최대 8개씩 나누어 생성한다. 범위 전체를 보내며 출처·형식·문자열 기준 중복 문항을 검증한다. 의미가 비슷한 문항은 교수 검토로 걸러야 한다.
- 교수님이 일부 또는 전체 문항을 선택해 게시한다. 한 초안은 한 번 게시한다.
- 학생에게는 게시된 문항의 문제와 보기만 제공한다. 서버 채점 후 본인의 오답·정답·풀이·페이지 출처를 제공한다.
- 퀴즈별 학생 제출은 1회다. 동일 요청 키의 재전송은 기존 결과를 반환한다.
- 서버를 다시 시작해도 게시·개인 결과를 보존한다. 진행 중 끊긴 작업은 실패로 표시한다.

지원 제한: 파일 하나 20MB, 문서 최대 500페이지. 구형 `.ppt`, 스캔 PDF/OCR, 그림·수식의 시각적 이해, 음성·영상 전사, 배포용 인증·DB·RLS는 미구현이다. 모델이 생성한 정답의 내용상 정확성은 교수 검토가 필요하다.

## 전체 기술 아키텍처

![LMS 에이전트 전체 기술 아키텍처](docs/assets/architecture.svg)

[Figma 편집 원본](https://www.figma.com/design/9W3QknQCIXbrdoy0yvCldZ?node-id=560-2) · [SVG 원본](docs/assets/architecture.svg) · [내보내기 정보](docs/assets/architecture.source.json)

위 이미지는 Figma에서 직접 내보낸 전체 목표 설계다. **그림의 생성 모델 Gemini는 이후 사용자 요청으로 GPT로 변경되었다. 현재 코드는 로컬 Codex / OpenAI API 어댑터를 제공한다.** 그림의 Supabase·Jev 등 전체 구성이 이미 구현된 것은 아니다. 현재 동작과 목표 설계의 차이는 [구현 현황](docs/implementation.md)을 참조한다.

## 협업과 검증

[역할별 이슈](https://github.com/2026-sku-campusthon/campus-lms-agent/issues) · [개발 순서](docs/development-plan.md) · [AI 협업 지침](AGENTS.md) · [API 계약](docs/contracts/openapi.yaml) · [검증 기록](docs/verification.md)

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

검사 명령도 Python 가상 환경을 활성화한 셸에서 실행한다. 브라우저 자동 검사는 실제 문서 처리를 호출하되 모델 응답은 테스트 대역이다. 실제 모델 호출과 구분한다. `scripts/verify-live-flow.ts <파일 경로> [문항 수] [시작 페이지] [끝 페이지]`는 설정한 실제 제공자로 생성·게시·채점을 검증하며 로컬 `.data/`에 결과를 남긴다.

계약 검사는 `requirements-contracts.txt`를 설치한 Python으로 `scripts/check_contracts.py`를 실행한다. [기획·페르소나](docs/product.md) · [기술 선택과 재사용 검토](docs/architecture.md) · [AI 협업 방법](docs/coordination.md)
