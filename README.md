# 서경대 Campus LMS Agent

강의 자료로 자율 학습 퀴즈와 Q&A를 제공하고, 교수님이 필요한 질문에 직접 개입하도록 돕는 프로젝트다. 교수·학생은 같은 사이트를 사용한다.

**현재 상태: 기획·기술 설계·협업 기반 구성. 앱 구현과 서비스 배포는 아직 완료되지 않았다.** 개발 마감은 2026-10-31, 내부 통합 목표는 10월 30일이다. 팀원 4명이 각자의 AI와 개발한다.

## 전체 기술 아키텍처

![LMS 에이전트 전체 기술 아키텍처](docs/assets/architecture.svg)

[Figma 편집 원본](https://www.figma.com/design/9W3QknQCIXbrdoy0yvCldZ?node-id=560-2) · [SVG 원본](docs/assets/architecture.svg) · [내보내기 정보](docs/assets/architecture.source.json)

위 이미지는 Figma 출력 페이지의 최신 LMS 프레임을 직접 내보낸 것이다. Q&A 검색 이후의 **Jev 판단**과 답변·추가 질문 1회·교수님 승격 경로를 포함한다.

## 구현할 기능

- 교수님: 주차·PPT 페이지 범위 지정, 약 50개 문항 생성, 일부/전체 선택 게시, 원본 공개 설정.
- 학생: 선택적 퀴즈 풀이, 제출 후 자신의 오답과 풀이 확인.
- Q&A: 주차별 PPT·녹음·영상 전사에서 검색, Jev 판단, Gemini 응답, 추가 질문 최대 1회, 교수님 연결.
- 레포트: 교수용 주차별 문항 정답률·참여율·질의 내역, 학생 개인 오답.

## 개발 시작

1. [AGENTS.md](AGENTS.md)를 읽고 [역할과 개발 순서](docs/development-plan.md)를 확인한다.
2. 담당 이슈를 맡고 API·Worker 계약을 확인한다. 계약은 현재 **초안**이며 첫 작업에서 고정한다.
3. 작업별 브랜치에서 구현하고 PR에 실제 검증 결과를 기록한다.

[기획·페르소나](docs/product.md) · [기술 선택·재사용 후보·일정](docs/architecture.md) · [AI 협업 방법](docs/coordination.md) · [API 계약](docs/contracts/openapi.yaml) · [Worker 계약](docs/contracts/worker.schema.json) · [작업 이슈](https://github.com/2026-sku-campusthon/campus-lms-agent/issues)

기본 기술은 React/Vite/TypeScript, Express, Supabase/PostgreSQL/pgvector, Python Worker, Docling, faster-whisper, Gemini, TypeSafe Jev다. Quizify의 코드 재사용은 실행 검증 후 결정한다. 모델·호스팅·집계 정책은 아직 확정하지 않았다.

## 계약 검증

앱 실행 명령은 구현 PR에서 추가한다. 현재 실행할 수 있는 검증은 문서·계약 검사다.

```bash
python3 -m venv .venv-contracts
.venv-contracts/bin/python -m pip install -r requirements-contracts.txt
.venv-contracts/bin/python scripts/check_contracts.py
```

이 검사는 OpenAPI 형식, Worker 샘플, 학생 응답의 정답 비노출, Figma SVG 체크섬을 확인한다. 실제 앱의 권한·모델 품질·통합 동작을 보증하지 않는다.
