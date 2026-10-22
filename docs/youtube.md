# YouTube 주차별 Q&A 근거

API `0.6.0-youtube.1`. 교수의 **녹음·동영상** 탭에서 **YouTube 강의 연결**에 공개 영상 링크를 넣는다. 제작자/자동 자막을 먼저 가져오며, 가져올 수 있는 자막이 없으면 음성을 내려받아 로컬 faster-whisper로 전사한다. 완료된 근거만 같은 강의·주차의 Q&A에 포함한다. 기존 Jev 판단·추가 질문 1회·교수 승격·Claude 답변을 유지한다.

## 시간 구간과 출처

링크의 `t=732s`, `t=12m12s`, `start=732`는 12분 12초부터 시작한다. 시작·끝 시간을 초 단위로 수정할 수 있고 끝을 비우면 영상 끝까지 사용한다. 자막·ASR 출처는 잘라낸 파일의 0초가 아니라 **YouTube 원본 절대 시간**으로 저장한다. 선택 구간과 겹치는 자막은 시각만 경계로 제한하며 한 문장의 일부 단어를 시간에 맞춰 다시 정렬하지 않는다.

`duration_sec`는 원본 전체 길이, `youtube.start_sec/end_sec`는 선택 구간이다. 전체 길이가 120분 이하인 영상만 지원한다. 더 긴 영상의 일부 구간 입력은 아직 지원하지 않는다. Q&A·교수 레포트의 출처에서 권한이 있는 경우 YouTube의 해당 시각으로 이동한다. 앱 안에 YouTube 플레이어나 다운로드한 음성을 보관하지 않으며 끝 시각에 YouTube 재생을 자동 정지시키지 않는다.

## 공개 범위

**학생에게 YouTube 원본 링크·전체 전사 공개**는 이 앱에서의 접근 범위다. 비공개 자료도 Q&A 근거로 사용할 수 있지만 학생에게 원본 URL/ID·전체 전사·원본 이동 권한을 제공하지 않는다. 교수는 해당 강의 자료를 확인할 수 있고, 공개 자료도 다른 강의 사용자는 접근할 수 없다. YouTube 자체의 공개 상태나 외부 사이트 접근 권한을 이 앱이 변경하지는 않는다.

## 설치

YouTube용 Python은 3.10 이상이 필요하며 현재 로컬 검증은 3.12로 수행했다. Node·ffmpeg·ffprobe는 기존 앱 설치를 따른다. yt-dlp는 시스템 Node 런타임으로 YouTube JS 처리를 수행한다.

```bash
python3.12 -m venv .venv-youtube
.venv-youtube/bin/python -m pip install -r worker/requirements-youtube.txt
```

`.env`에 `YOUTUBE_PYTHON_BIN=<저장소 절대경로>/.venv-youtube/bin/python`을 설정한 뒤 서버를 다시 시작한다. 비우면 기존 `PYTHON_BIN`을 사용한다. ASR 캐시는 기존 `WHISPER_CACHE_DIR` 또는 `DATA_DIR/models`를 공유한다. 전사·자막 수집 API 키는 추가하지 않으며 Q&A의 Claude·Jev 호출은 기존 API 요금을 따른다.

`faster-whisper==1.2.1`은 PyAV 19에서 제거된 `metadata_errors`를 사용하므로 공용 미디어 의존성을 `av>=11,<19`로 제한했다. 새 Python 환경의 실제 음성 경로에서 발견한 호환 문제다. 원래 Python 3.9 미디어 환경의 PyAV 15.1.0은 이 제한을 만족한다.

## 입력·처리 제한

- `youtube.com`(www/m/music 포함)의 watch/shorts/embed, `youtu.be` HTTPS 단일 영상만 받는다. 영상 ID·호스트·포트·자격 정보·시간을 검사한 뒤 서버가 정규 YouTube URL을 만든다. 재생목록/추적 인자는 수집 URL에 전달하지 않는다. 임의 URL 수집·셸 명령 입력은 지원하지 않는다.
- 자막은 한국어, 영어 순서로 선호하며 각 언어에서 제작자 자막을 먼저 선택한다. 자동 번역은 수행하지 않는다. 실제 자막의 오류를 정답으로 보증하지 않는다.
- 영상 전체 최대 120분, 다운로드할 음성 최대 500MB. 기존 파일 업로드와 직렬 처리·처리/대기 합계 3개·Job 저장·60분 작업 제한·명시적 재시도를 공유한다. 음성 원본과 잘라낸 WAV는 작업 임시 디렉터리에서 정리한다.
- 비공개·삭제·로그인/연령 제한·라이브·공개 예정 영상은 가져오지 않는다. 브라우저 쿠키, 계정 인증, 프록시로 제한을 우회하지 않는다. YouTube 접근 제한/형식 변경은 오류로 남기고 파일 업로드 또는 명시적 재시도를 안내한다.
- 완료 전이나 실패한 근거는 검색하지 않는다. 선택 시간 밖 결과를 거부하며 API 키·서명된 다운로드 URL·원문 오류를 브라우저에 반환하지 않는다.

## API와 검증

`POST /api/courses/{course_id}/weeks/{week_id}/youtube`는 `{url, start_sec?, end_sec?, original_visible_to_students}` JSON을 받으며 202와 자료·Job ID를 반환한다. 기존 transcript/playback/transcription-retry API를 재사용한다. YouTube playback/original은 권한 검사 후 정규 원본 URL과 시작 시간으로 302 이동한다. 파일 미디어의 Range 206과 구분한다.

`node --import tsx scripts/verify-live-youtube.ts '<링크>' [private|public] [끝 초] [내용에 맞는 질문]`은 실제 수집·Jev·생성 API를 임시 DB에서 검사한다. 기본 질문은 제공된 공학수학 강의의 중장기 학습 목표다. 본문 없는 메타데이터만 로컬 `.data/verification-youtube`에 남기고 임시 DB는 삭제한다. 실제 호출과 자동 검사의 대역을 구분한다.

[youtube-transcript-api 공식 문서](https://github.com/jdepoix/youtube-transcript-api) · [yt-dlp 공식 문서](https://github.com/yt-dlp/yt-dlp) · [PyAV 변경 기록](https://pyav.basswood.io/docs/stable/development/changelog.html) · [검증 결과](verification.md)
