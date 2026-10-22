# 녹음·동영상 자동 전사

API `0.5.0-media.1`. 교수의 **녹음·동영상** 탭에서 주차별 파일을 등록하면 자동으로 전사한다. 완료된 전사만 같은 강의·주차 Q&A의 검색 근거에 포함한다. Claude는 문장을 생성하고 Jev는 명확성·근거 충분성을 판단한다. 전사 모델은 로컬 faster-whisper이며 별도 전사 API 키가 필요하지 않다.

후속 API `0.6.0-youtube.1`은 같은 화면에서 [YouTube 링크 수집](youtube.md)도 제공한다. 이 문서의 파일 업로드·Range 재생 규칙은 로컬 파일에 적용하며 YouTube 원본은 권한 확인 후 302로 원본 시각에 이동한다.

## 설치와 실행

ffmpeg·ffprobe와 Python 3.9 이상이 필요하다. macOS는 `brew install ffmpeg`, Ubuntu는 `sudo apt-get install ffmpeg`로 설치할 수 있다. 이 앱은 입력 검사와 음성 분리를 위해 두 명령을 직접 사용한다.

```bash
python3 -m venv .venv-worker
.venv-worker/bin/python -m pip install -r worker/requirements-media.txt
```

`.env`의 `PYTHON_BIN`은 `<저장소 절대경로>/.venv-worker/bin/python`으로 설정한다. 심볼릭 링크의 실제 시스템 Python 경로로 치환하면 가상 환경을 우회할 수 있으므로 가상 환경 안의 실행 경로를 그대로 사용한다.

기본은 `WHISPER_MODEL=small`, `WHISPER_LANGUAGE=auto`다. CPU int8·한 번에 한 파일로 실행한다. 첫 실행에는 공개 모델 가중치를 내려받고 이후 `DATA_DIR/models`에서 재사용한다. `WHISPER_CACHE_DIR`로 캐시 경로를 바꿀 수 있다. `FFMPEG_BIN`, `FFPROBE_BIN`으로 명령 경로도 지정할 수 있다. 환경을 바꾼 뒤 서버를 다시 시작한다.

## 지원 범위

- 오디오: MP3, M4A, WAV, OGG, FLAC.
- 비디오: MP4, MOV, WebM, MKV. 영상의 첫 음성 트랙을 전사하며 화면·판서 인식은 수행하지 않는다.
- 한 파일 500MB 이하, 음성 길이 120분 이하. 파일은 메모리에 통째로 받지 않고 비공개 디렉터리에 스트리밍 저장한다.
- 동시 전사는 한 파일, 처리 중·대기 합계 3개다. 시간 초과는 60분이며 자료 크기·CPU·모델에 따라 긴 강의의 처리 시간이 달라진다.
- ffprobe로 컨테이너·트랙·알려진 길이를 검사하고, ffmpeg로 최대 120분+1초의 mono 16kHz WAV를 만든 뒤 실제 길이를 다시 확인한다. 허용 프로토콜은 로컬 file/pipe다.
- 전사 세그먼트의 시작·끝 시간, 길이, 순서와 텍스트를 Python과 서버 양쪽에서 검사한다. 무음·음성 트랙 없음·파일 손상·모델 오류를 완료로 처리하지 않는다.

전사 화면에서 구간을 확인하고 재생할 수 있다. 전문용어·잡음·화자 겹침·언어 인식에 따른 오류가 있을 수 있어 중요한 내용은 원본과 함께 확인한다. 120분짜리 실제 강의의 처리 시간·정확도를 측정 완료한 것은 아니다.

## 공개 여부와 Q&A

**학생에게 원본·전체 전사 공개** 선택은 원본 재생·전체 전사 조회 권한이다. 비공개 자료도 교수의 업로드 요청에 따라 Q&A 처리는 허용되지만 학생에게 전체 전사·원본 재생 권한을 주지 않는다. 같은 강의 교수는 비공개 자료도 검사할 수 있다. 다른 강의 사용자는 공개 표시 여부와 관계없이 차단한다.

Q&A 답변에는 문서 페이지 또는 전사 시작·끝 시간을 출처로 보존한다. 화면은 시간 구간을 표시하고 원본 접근이 허용될 때만 해당 구간 재생기를 제공한다. 재생 API도 강의 권한·공개 여부를 검사하고 HTTP Range를 지원한다. 교수 Q&A 레포트에도 같은 시간 출처를 표시한다.

현재 검색은 단어 기반이며 인접 전사를 최대 약 1,000자·60초씩 묶어 검색한다. 원문 언어와 질문 표현의 차이·전사 오류로 근거가 검색되지 않으면 Jev 판단과 기존 추가 질문 1회·교수 승격 규칙을 따른다. 퀴즈는 PDF/PPTX와 완료된 YouTube 자료를 지원한다(API 0.7.0-youtube-quiz.1). 파일로 올린 녹음·동영상은 현재 Q&A 근거로만 사용한다.

## 작업·재시도·저장

업로드는 202로 자료·Job ID를 반환한다. 처리 상태와 오류를 저장하며 웹 화면을 이동해도 접수된 전사는 계속된다. 실패한 원본은 보존하고 재시도 가능한 오류에만 명시적 재전사를 제공한다. 처리 중·완료 상태의 중복 재시도는 거부한다. 서버 재시작으로 중단된 작업은 실패로 표시하고 재시도한다. 자동 재시도·다른 전사 제공자 자동 대체는 없다.

기존 문서 JSON은 source_type이 없는 경우 document로 해석하여 호환한다. 자료 목록에는 전체 전사·파일 경로를 넣지 않고 전용 API로 조회한다. 완료 전 전사나 실패 전사를 검색하지 않는다. 전사 자식 프로세스에는 Anthropic·OpenAI·TypeSafe 등 앱 API 키를 전달하지 않는다.

## API

- `POST /api/courses/{course_id}/weeks/{week_id}/media`: file, source_type(audio/video), original_visible_to_students(true/false)의 multipart 업로드.
- `GET /api/materials/{material_id}/transcript`: 상태·길이·인식 언어·전사 구간·오류.
- `GET /api/materials/{material_id}/playback`: 원본·Range 응답. 비공개 학생은 403.
- `POST /api/materials/{material_id}/transcription-retry`: 빈 JSON으로 재시도 가능한 실패만 새 Job에 접수.

Worker 큐 draft-1은 목표 계약으로 유지한다. 현재 구현은 별도 Python CLI `worker/transcribe_media.py`가 `{duration_sec, language, segments}`를 반환하며 Supabase 큐·다중 Worker·lease를 구현한 것은 아니다.

## 검증 방법

`node --import tsx scripts/verify-live-media.ts <실제 음성/영상 경로> [private|public] [검증 질문]`은 실제 전사·Jev·생성 API를 호출한다. 기본 검증 질문은 정규화에 관한 질문이므로 다른 강의는 실제 내용에 맞는 질문을 지정한다. 입력은 임시 DB에 복사하고 메타데이터만 로컬 `.data/verification-media`에 보존한다. 실제 강의 원본·전사·답변 본문은 커밋하지 않는다. 실제 호출과 자동 검사의 테스트 대역을 구분한다.

[공식 faster-whisper](https://github.com/SYSTRAN/faster-whisper) · [현재 검증 결과](verification.md)
