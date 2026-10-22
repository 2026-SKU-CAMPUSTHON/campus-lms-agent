"""Public YouTube captions first, bounded audio ASR second. No browser cookies."""
import argparse
import html
import json
import math
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from transcribe_media import MediaError, MAX_SECONDS, MAX_SEGMENTS, transcribe

MAX_BYTES = 500 * 1024 * 1024


class QuietLogger:
    def debug(self, *_): pass
    def warning(self, *_): pass
    def error(self, *_): pass


def options():
    return {'quiet': True, 'logger': QuietLogger(), 'noplaylist': True,
            'socket_timeout': 15, 'retries': 1, 'extractor_retries': 1,
            'fragment_retries': 1, 'ignore_no_formats_error': True,
            'js_runtimes': {'node': {}}, 'cachedir': False,
            'extractor_args': {'youtube': {'skip': ['translated_subs']}},
            'nocheckcertificate': False}


def fetch_error(error):
    # Classify upstream messages without returning titles, signed URLs or raw errors.
    text = str(error).lower()
    if any(s in text for s in ['sign in', 'not a bot', 'captcha', '429', '403', 'blocked']):
        return MediaError('YOUTUBE_ACCESS_BLOCKED', 'YouTube가 자동 접근을 제한했습니다. 잠시 뒤 다시 시도하거나 녹음·동영상 파일로 올려 주세요.')
    if any(s in text for s in ['private video', 'video unavailable', 'removed', 'members-only', 'age-restricted', 'not available']):
        return MediaError('YOUTUBE_UNAVAILABLE', '공개된 일반 영상만 가져올 수 있습니다. 비공개·삭제·로그인 제한 영상을 확인해 주세요.')
    return MediaError('YOUTUBE_FETCH_FAILED', 'YouTube 자료를 가져오지 못했습니다. 잠시 뒤 다시 시도하거나 파일로 올려 주세요.')


def validate_range(info, video_id, start, end):
    duration = info.get('duration')
    if info.get('id') != video_id or info.get('_type', 'video') != 'video':
        raise MediaError('YOUTUBE_UNAVAILABLE', '하나의 공개 영상만 지원합니다.')
    if info.get('is_live') or info.get('live_status') in {'is_live', 'is_upcoming', 'post_live'}:
        raise MediaError('YOUTUBE_UNAVAILABLE', '진행 중인 라이브·공개 예정 영상은 가져올 수 없습니다.')
    if not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0:
        raise MediaError('YOUTUBE_UNAVAILABLE', '영상 길이를 확인하지 못했습니다. 파일로 올려 주세요.')
    if duration > MAX_SECONDS:
        raise MediaError('MEDIA_TOO_LONG', '현재 YouTube 영상은 전체 길이 120분 이하만 지원합니다.')
    end = duration if end is None else end
    if not math.isfinite(start) or not math.isfinite(end) or start < 0 or start >= end or end > duration:
        raise MediaError('YOUTUBE_RANGE_INVALID', '선택한 시간 구간이 영상 길이를 벗어났습니다.')
    return duration, end


def caption_segments(snippets, start, end):
    segments = []
    for snippet in snippets:
        a, span = float(snippet.start), float(snippet.duration)
        if not math.isfinite(a) or not math.isfinite(span) or a < 0 or span < 0:
            raise MediaError('INVALID_TRANSCRIPT', 'YouTube 자막의 시간 정보를 확인하지 못했습니다.')
        b = a + span
        if b <= start or a >= end:
            continue
        text = html.unescape(re.sub(r'<[^>]*>', '', snippet.text)).strip()
        # Keep source text literal; captions are untrusted evidence, never instructions.
        if not text or b <= a:
            continue
        if len(text) > 6000 or len(segments) >= MAX_SEGMENTS:
            raise MediaError('TRANSCRIPT_TOO_LARGE', '자막이 너무 깁니다. 더 짧은 구간을 지정해 주세요.')
        segments.append({'start_sec': round(max(a, start), 3), 'end_sec': round(min(b, end), 3), 'text': text})
    segments.sort(key=lambda segment: segment['start_sec'])
    segments = [s for s in segments if s['end_sec'] > s['start_sec']]
    if sum(len(s['text']) for s in segments) > 600000:
        raise MediaError('TRANSCRIPT_TOO_LARGE', '자막이 너무 깁니다. 더 짧은 구간을 지정해 주세요.')
    return segments


def fetch_captions(video_id, start, end):
    from youtube_transcript_api import YouTubeTranscriptApi
    from requests import Session
    class TimedSession(Session):
        def request(self, method, url, **kwargs):
            kwargs['timeout'] = 15
            return super().request(method, url, **kwargs)
    with TimedSession() as session:
        tracks = list(YouTubeTranscriptApi(http_client=session).list(video_id))
        if not tracks:
            return None
        # Prefer Korean, then English; manual captions before automatic in each language.
        tracks.sort(key=lambda t: (0 if t.language_code == 'ko' else 1 if t.language_code == 'en' else 2, t.is_generated))
        track = tracks[0]
        segments = caption_segments(track.fetch(), start, end)
        return {'segments': segments, 'language': track.language_code, 'is_generated': track.is_generated} if segments else None


def download_audio(url, directory):
    from yt_dlp import YoutubeDL
    def bounded(progress):
        if progress.get('downloaded_bytes', 0) > MAX_BYTES:
            raise MediaError('YOUTUBE_TOO_LARGE', '영상의 음성이 500MB를 넘습니다. 파일을 나누어 올려 주세요.')
    settings = {**options(), 'format': 'bestaudio/best', 'max_filesize': MAX_BYTES,
                'outtmpl': str(directory / 'source.%(ext)s'), 'progress_hooks': [bounded]}
    with YoutubeDL(settings) as downloader:
        downloader.extract_info(url, download=True)
    files = [p for p in directory.glob('source.*') if p.suffix in {'.webm', '.m4a', '.mp4', '.mp3', '.ogg', '.opus'}]
    if len(files) != 1 or not 0 < files[0].stat().st_size <= MAX_BYTES:
        raise MediaError('YOUTUBE_TOO_LARGE', '500MB 이하의 음성 파일을 준비하지 못했습니다. 직접 파일로 올려 주세요.')
    return files[0]


def audio_transcript(url, start, end, model, language, cache, ffmpeg, ffprobe):
    with tempfile.TemporaryDirectory(prefix='campus-youtube-') as directory:
        path = Path(directory)
        try:
            source = download_audio(url, path)
        except MediaError:
            raise
        except Exception as error:
            raise fetch_error(error)
        cropped = path / 'selected.wav'
        try:
            subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-ss', str(start), '-i', str(source), '-t', str(end-start), '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', str(cropped)], capture_output=True, timeout=180, check=True)
        except FileNotFoundError:
            raise MediaError('MEDIA_NOT_CONFIGURED', 'ffmpeg 설치를 확인해 주세요.')
        except Exception:
            raise MediaError('AUDIO_DECODE_FAILED', 'YouTube 음성 구간을 변환하지 못했습니다. 파일로 올려 주세요.')
        result = transcribe(cropped, 'audio', model, language, cache, ffmpeg, ffprobe)
        for segment in result['segments']:
            segment['start_sec'] = round(start + segment['start_sec'], 3)
            segment['end_sec'] = round(min(end, start + segment['end_sec']), 3)
        return result


def import_youtube(video_id, start=0, end=None, model='small', language='auto', cache=None, ffmpeg='ffmpeg', ffprobe='ffprobe'):
    if not re.fullmatch(r'[A-Za-z0-9_-]{11}', video_id):
        raise MediaError('YOUTUBE_RANGE_INVALID', '영상 ID를 확인해 주세요.')
    try:
        from yt_dlp import YoutubeDL
        import youtube_transcript_api  # Check both optional dependencies before network work.
    except ImportError:
        raise MediaError('YOUTUBE_NOT_CONFIGURED', 'Python 3.10 이상 환경에 worker/requirements-youtube.txt를 설치해 주세요.')
    url = 'https://www.youtube.com/watch?v=' + video_id
    try:
        with YoutubeDL(options()) as downloader:
            info = downloader.extract_info(url, download=False)
    except Exception as error:
        raise fetch_error(error)
    duration, selected_end = validate_range(info, video_id, start, end)
    name = re.sub(r'[\x00-\x1f\x7f]', ' ', info.get('title') or 'YouTube 강의').strip()[:180] or 'YouTube 강의'
    try:
        captions = fetch_captions(video_id, start, selected_end)
    except MediaError:
        raise
    except Exception:
        captions = None
    if captions:
        return {'name': name, 'method': 'captions', 'is_generated': captions['is_generated'],
                'transcription': {'duration_sec': duration, 'language': captions['language'], 'segments': captions['segments']}}
    result = audio_transcript(url, start, selected_end, model, language, cache, ffmpeg, ffprobe)
    result['duration_sec'] = duration  # Original timeline, not clip-relative duration.
    return {'name': name, 'method': 'audio', 'is_generated': None, 'transcription': result}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--video-id', required=True)
    parser.add_argument('--start', type=float, default=0)
    parser.add_argument('--end', type=float)
    parser.add_argument('--model', default='small')
    parser.add_argument('--language', default='auto')
    parser.add_argument('--cache-dir')
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('--ffprobe', default='ffprobe')
    args = parser.parse_args()
    try:
        result = import_youtube(args.video_id, args.start, args.end, args.model, args.language, args.cache_dir, args.ffmpeg, args.ffprobe)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except MediaError as error:
        print(json.dumps({'code': error.code, 'error': str(error)}, ensure_ascii=False))
    except Exception:
        print(json.dumps({'code': 'YOUTUBE_FETCH_FAILED', 'error': 'YouTube 근거를 준비하지 못했습니다. 링크를 확인하거나 파일로 올려 주세요.'}, ensure_ascii=False))
    return 1


if __name__ == '__main__':
    sys.exit(main())
