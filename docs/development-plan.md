# 개발 순서와 역할

마감: 2026-10-31 (한국 시간). 10월 30일 통합·시연 완료를 목표로 한다. 현재 이슈들은 구현 전 작업 목록이다. 역할의 실제 GitHub 계정은 팀이 배정한다.

| 담당 | 책임 | 첫 작업 |
| --- | --- | --- |
| A | 인증·강의·DB·권한·API 계약·레포트·통합·배포 | Quizify 실행 검증과 공용 계약 고정 |
| B | 같은 사이트의 교수·학생 화면 | 계약 샘플로 웹 화면 구성 |
| C | 문서·전사 Worker·색인·퀴즈 생성 | PPT 페이지와 선택 범위 보존 |
| D | Q&A 검색·Jev·생성·추가 질문·승격 | Jev 접근·한국어 판단 사전 검증 |

| 날짜 | 구현 순서 | 완료 기준 |
| --- | --- | --- |
| 10/21–22 | Quizify 실행 확인, API/Worker/DB 계약 고정. B·C·D는 샘플·실제 PPT·Jev를 병렬 확인 | 재사용 파일과 경계를 정하고 같은 계약 사용 |
| 10/23–24 | 인증·강의·주차, PPT 처리, 문제 생성·선택 게시·풀이 | 실제 PPT에서 개인 오답 확인까지 연결 |
| 10/25–26 | 주차 검색, Jev, Gemini, 상태 전환·교수님 답변 | 답변·추가 질문·승격 3개 경로 동작 |
| 10/27–28 | 주차별 레포트, 녹음·영상 음성 전사, 오류·재시도 | 요구한 두 기능 전체 연결 |
| 10/29 | 강의 격리·개인 기록·정답 비노출·중복 요청·모델 오류 통합 검사 | 기능 추가 종료, 결함 목록 확정 |
| 10/30 | 실제 환경 배포와 시연 | 새 계정·샘플로 전체 흐름 재현 |
| 10/31 | 최종 수정과 제출 | 제출·시연 완료 |

세부 재사용 범위·검증 사례는 [아키텍처 10장](architecture.md#10-재사용-범위4인-역할개발-일정)을 따른다. 아래 이슈 목록을 구현 상태의 기준으로 사용한다.

## GitHub 작업 목록

| 이슈 | 역할 | 작업 |
| --- | --- | --- |
| [#1](https://github.com/2026-sku-campusthon/campus-lms-agent/issues/1) | A | 플랫폼·인증·강의·DB 계약·통합 |
| [#2](https://github.com/2026-sku-campusthon/campus-lms-agent/issues/2) | B | 교수·학생 화면 |
| [#3](https://github.com/2026-sku-campusthon/campus-lms-agent/issues/3) | C | 자료 처리·퀴즈 생성·전사 |
| [#4](https://github.com/2026-sku-campusthon/campus-lms-agent/issues/4) | D | Q&A·Jev·추가 질문·승격 |
| [#5](https://github.com/2026-sku-campusthon/campus-lms-agent/issues/5) | A/B/C 통합 | 첫 PDF/PPTX 퀴즈 기능 |
| [#6](https://github.com/2026-sku-campusthon/campus-lms-agent/issues/6) | 전원 | 권한·레포트·배포·리허설 |

역할 계정은 미배정이다. 실제 상태는 이슈를 따른다. 첫 기능은 [구현 현황](implementation.md)과 [검증 기록](verification.md)을 확인한다.
