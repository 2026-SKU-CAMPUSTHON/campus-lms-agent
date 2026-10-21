# 계약 초안 draft-1

현재 파일은 네 담당이 병렬 개발을 시작하기 위한 초안이다. 첫 계약 고정 작업 전까지 확정된 서버 동작으로 간주하지 않는다. `openapi.yaml`은 JSON 문법으로 작성한 유효 YAML이다.

- JWT의 사용자 UUID와 강의 membership을 서버가 검사한다. 클라이언트가 학생 UUID·교수 역할을 임의 지정하지 않는다.
- 문서 페이지는 1부터, 범위 양 끝 포함. 전사 시간은 초 단위다. Worker는 원본 공개 여부와 관계없이 교수의 허용된 처리 요청만 받는다.
- Worker 계약은 **추출 요청·결과**다. 자료 추출은 Python, 결과 정규화·저장·임베딩 색인과 생성 호출은 C가 구현할 Node 모듈에서 수행한다. 정확한 모듈 경계는 A/C가 고정한다.
- PostgreSQL 작업은 잠금/lease로 단일 확보하고 중복 처리·crash 후 재확보를 처리한다. 계약은 이를 구현하지 않는다. 원본은 bucket/object_key로 전달하며 장기 비밀키나 만료된 서명 URL을 결과에 기록하지 않는다.
- Worker 결과의 문서 segment는 slide_no, 전사는 start_sec/end_sec를 보존한다. 세 필드의 혼용과 범위 역전은 실행 시 검사한다.
- 학생 문제 응답은 PublicQuiz, 교수 초안은 QuizDraft, 제출 결과는 AttemptResult다. 학생이 정답이 든 DB 테이블을 직접 조회할 수 없도록 권한도 구현해야 한다.
- Q&A는 open / awaiting_student / awaiting_professor / resolved이며 추가 질문은 스레드당 1회다. processing_status/error는 업무 상태와 별개다. Jev·Gemini 호출 실패를 근거 부족으로 처리하지 않는다.
- Jev 모델명·확률 임계값·재시도 예산은 실제 한국어 검증 후 결정한다. 내부 Jev 어댑터 결과에는 clarity, evidence_sufficient, model_version, 판단 확률·출처 ID를 기록한다. 지금 임의의 SDK 응답 형식을 확정하지 않는다.

첫 계약 PR에서 정할 것: memberships 등록/관리 API, Job 성공 결과의 draft_id 등 참조, 업로드 크기/형식, pagination, 통계 분모와 재응시 규칙, 임베딩 모델/차원, DB 스키마, 동시성·재시도 정책, 마이그레이션 소유권. PR에서 계약 버전·샘플·호출 코드를 함께 갱신한다.
