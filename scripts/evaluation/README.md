# 실제 모델 평가 실행기

`run.ts`는 기존 앱의 실제 추출·검색·Claude 생성·Jev 판단을 **격리된 로컬 SQLite**에서 호출한다. 유료 API 사용량이 발생한다. 운영 MySQL 또는 학생 기록을 사용하지 않는다. [실행 결과와 제한](../../docs/evaluation/results-2026-10-26.md)을 먼저 읽는다.

## 준비와 실행

앱 의존성(`npm ci`), worker 가상환경, `.env`의 `ANTHROPIC_API_KEY`·`TYPESAFE_API_KEY`가 필요하다. 키를 로그나 명령 인수에 넣지 않는다. 데이터 세트 파일의 원문 해시와 일치하는 PDF와 기존 자막 스냅샷을 로컬에서 준비한다. 자막 JSON은 기존 저장 자료 형식의 `name`, `segments`, `duration_sec`, `youtube` 필드를 포함한다. 각 segment는 `start_sec`, `end_sec`, `text`를 갖는다. 스냅샷은 공개 저장소에 포함하지 않는다.

```bash
export PYTHON_BIN="$PWD/.venv-worker/bin/python"
node --import tsx scripts/evaluation/run.ts prepare UNIQUE_RUN_ID /absolute/lecture.pdf /absolute/youtube-source.json
node --import tsx scripts/evaluation/run.ts execute UNIQUE_RUN_ID
```

준비 이후 실행까지 코드 커밋·실행기·세트·자료·모델 설정이 바뀌면 중단한다. 실행한 run ID를 재사용할 수 없으며 실패 기록도 보존한다. 개발 6×2 → 퀴즈 3×10 → 최종 후보 30×2 순서다. API 인증/한도 오류가 나면 중단한다. 재개가 필요하면 실패 원인을 확인한 뒤 새 ID로 별도 실행하고 첫 실패를 보고한다.

`direct_answer`는 판단기만 고정 우회하고 출처 없는 답변의 기존 승격을 유지한다. 이 조건에는 자동 보완 질문이 없다. 우회에 사용한 confidence=1은 모델 확률이 아니다. `jev_gate`는 현재 정책 그대로다. 같은 자료와 초기 검색 결과를 조건별로 사용하고 보완 응답은 보완 요청 시 한 번만 전송한다. 기존 원본 공개 정책은 바꾸지 않는다.

실행기는 reviewer 정답 본문을 프롬프트에 넣거나 인덱싱하지 않는다(세트 해시 기록을 위한 바이트 읽기는 수행). 내용 채점은 이후 별도 단계다. 실제 Jev 입력은 결과의 `observations`에 저장하며 SDK Request 형태 때문에 원 transport request body는 null일 수 있다. 헤더·쿠키·API 키는 기록하지 않는다.

## 초벌 점수 집계

원문과 실제 출력 검토 후 로컬 `provisional-grades.json`을 작성한다. AI 초벌 집계는 아래 형식으로 명시하며 사람 최종 점수와 분리한다.

```json
{
  "run_id": "UNIQUE_RUN_ID",
  "review_type": "AI provisional; no independent human approval",
  "qa": {
    "QA01_direct_answer": {
      "correctness": 2, "grounded": 1, "citation_correct": 1,
      "unsupported_answer": 0, "retrieval_hit": 1,
      "failure_stage": "없음", "notes": "페이지/시간과 판정 근거"
    }
  },
  "quiz": {
    "G1-01": {
      "correct": 1, "explanation": 1, "options": 1, "in_scope": 1,
      "duplicate": 0, "disposition": "그대로 사용", "notes": "판정 근거"
    }
  }
}
```

실제 파일에는 Q&A 60개·퀴즈 30개가 모두 필요하다. 답변이 없으면 correctness/grounded/citation_correct는 null, 원래 답 없는 검색 적중도 null이다. 미확인 금액을 0으로 채우지 않는다.

```bash
python3 scripts/evaluation/summarize.py UNIQUE_RUN_ID /absolute/provisional-grades.json
./node_modules/.bin/tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck scripts/evaluation/run.ts
```

집계기는 완료 표식·60개 ID·채점 범위·초기 검색 쌍 일치를 검사한 후 run 폴더에 `summary.json`, `scored-records.json`을 쓴다. 후자는 실제 원문/응답이 포함되어 공개하면 안 된다. `summary.json`만 익명 집계로 검토해 게시할 수 있다. 입력 채점 파일을 수정하면 집계 결과가 바뀌므로 사용한 채점 파일을 버전별로 보존한다. 실행 원기록과 공개 빈 채점표는 덮어쓰지 않는다.
