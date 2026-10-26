# 평가 세트 v1 — 사람 검토 전 후보

[계획](../../docs/evaluation/README.md) · [채점 기준](../../docs/evaluation/rubric.md) · [빈 Excel](../../outputs/evaluation-20261026/campus-evaluation-scorecard.xlsx)

사람이 읽을 때는 [질문·참고 정답 전체 목록](reviewer-catalog.md)을 사용한다. JSON/JSONL과 같은 후보를 읽기 좋게 정리한 문서다.

정답은 확정 gold label이 아니다. PDF 선정 페이지는 텍스트·이미지로 확인했지만 사람 독립 검토는 아직 없다. 영상은 자동 자막 기반으로 원영상 확인이 필요하다. 실제 평가 점수는 없다.

| 파일 | 내용 | 대상 |
| --- | --- | --- |
| source-manifest.json | 자료 해시·범위·버전 | 실행자·검토자 |
| quiz-generation-tasks.json | 범위별 10문항 요청, 총 30슬롯 | 실행자 |
| quiz-reference.json | 참고 질문·정답·오답 주장 30개 | 검토자 전용 |
| qa-dev-inputs.jsonl | 개발 초기 질문·보완 응답 6개 | 개발 실행자 |
| qa-dev-reviewer.jsonl | 개발 기대 경로·근거 | 검토자 |
| qa-final-inputs.jsonl | 최종 후보 초기 질문·보완 응답 30개 | 평가 실행자 |
| qa-final-reviewer.jsonl | 최종 후보 경로·근거·정답 | 검토자 전용 |
| functional-cases.json | 권한·업무·저장·집계 12개 | 기능 검사자 |

inputs 파일 전체를 모델에 넣지 않는다. 실행기가 scope_id로 자료를 선택하고 question만 사용자 질문으로 전달한다. student_followup은 AI가 보완을 요청한 경우에만 다음 메시지로 보낸다. 기대 경로·정답은 모델에 전달하지 않는다.

QA01–10 답변 가능, QA11–20 모호, QA21–30 근거 부족이다. QR01–30은 실제 모델 출력이 아닌 참고 개념 질문이다. 새로 생성한 범위 내 올바른 질문도 인정한다.

검토자 두 명의 승인과 불일치 조정 후 버전·해시·검토 기록을 고정한다. 영상 seconds는 근거를 찾을 구간이며 정확히 같은 시간 문자열을 인용해야 한다는 뜻은 아니다. 원본 PDF·전체 자막은 포함하지 않는다. 실행 결과는 Git에서 제외된 `.data/evaluation-runs/<run_id>/`에 저장한다. 공개 후보를 비공개·미노출 벤치마크라고 주장하지 않는다. 후보 변경 시 Excel 정답검토도 동기화한다.
