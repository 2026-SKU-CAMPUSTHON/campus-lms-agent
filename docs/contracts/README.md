# API 0.3.1-claude.1 / Worker 큐 draft-1

API의 구현된 첫 기능은 x-implementation-status=implemented로 표시한다. planned는 아직 구현되지 않은 계약이다. 로컬 구현은 세션 쿠키, 후속 Supabase 구현은 JWT를 사용한다. Worker 큐 계약은 초안이다. `openapi.yaml`은 JSON 문법으로 작성한 유효 YAML이다.

- 현재 로컬 세션의 사용자 UUID와 강의 membership을 서버가 검사한다. 후속 배포 인증은 JWT다. 클라이언트가 학생 UUID·교수 역할을 임의 지정하지 않는다.
- 문서 페이지는 1부터, 범위 양 끝 포함. 전사 시간은 초 단위다. Worker는 원본 공개 여부와 관계없이 교수의 허용된 처리 요청만 받는다.
- Worker 계약은 **추출 요청·결과**다. 자료 추출은 Python, 결과 정규화·저장·임베딩 색인과 생성 호출은 C가 구현할 Node 모듈에서 수행한다. 정확한 모듈 경계는 A/C가 고정한다.
- PostgreSQL 작업은 잠금/lease로 단일 확보하고 중복 처리·crash 후 재확보를 처리한다. 계약은 이를 구현하지 않는다. 원본은 bucket/object_key로 전달하며 장기 비밀키나 만료된 서명 URL을 결과에 기록하지 않는다.
- Worker 결과의 문서 segment는 slide_no, 전사는 start_sec/end_sec를 보존한다. 세 필드의 혼용과 범위 역전은 실행 시 검사한다.
- 학생 문제 응답은 PublicQuiz, 교수 초안은 QuizDraft, 제출 결과는 AttemptResult다. 재응시는 퀴즈당 1회 제출로 정했다. 학생이 정답이 든 DB 테이블을 직접 조회할 수 없도록 권한도 구현해야 한다.
- Q&A는 open / awaiting_student / awaiting_professor / resolved이며 추가 질문은 스레드당 1회다. processing_status/error는 업무 상태와 별개다. Jev·생성 모델 호출 실패를 근거 부족으로 처리하지 않는다.
- Jev 어댑터는 공식 TypeSafe SDK의 choice 응답을 `Decision`으로 변환한다. `clarity/evidence`의 label·confidence·선택지별 probabilities, model, 검색 출처 ID와 경로를 보존한다. 실제 Claude·Jev 연결은 소수 사례로 확인했다. 기본 모델 `jev-1.13.0`과 임계값 0.75는 한국어 평가 전 임시값이다.
- Q&A 쓰기는 `Idempotency-Key`가 필요하다. 답변·재시도는 `expected_version`도 받으며 오래된 버전은 409다. 학생 답변은 202, 교수 답변은 200이다. 학생의 최초 질문은 201이다.
- Q&A 목록은 주차별 최근 100개다. 학생은 본인만, 교수는 해당 강의 전체를 조회한다. `/decisions`는 교수 전용이다. Q&A 오류 재시도는 명시적이며 자동 반복하지 않는다. 동시에 처리하는 질문은 로컬 서버 전체 3개까지다.
- `qa-clarification.json`, `qa-handoff.json`은 합성 계약 샘플이다. 모델 평가나 실제 사용자 대화가 아니다.

후속 A 계약 PR에서 정할 것: memberships 등록/관리 API, Job 성공 결과의 draft_id 등 참조, 업로드 크기/형식, pagination, 통계 분모, 임베딩 모델/차원, DB 스키마, 동시성·재시도 정책, 마이그레이션 소유권. PR에서 계약 버전·샘플·호출 코드를 함께 갱신한다.

현재 Python CLI 추출 인터페이스와 목표 큐 계약의 차이는 [구현 현황](../implementation.md)에 기록한다. 기본 생성은 Claude API이며 퀴즈·Q&A에 적용한다. Codex는 명시적인 선택 모드이고 OpenAI/Gemini는 이전 퀴즈 전용 어댑터다.
