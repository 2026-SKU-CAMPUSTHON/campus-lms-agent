"""Local media transcription CLI. stdout contains only the result or a safe error."""
import argparse
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import wave

MAX_SECONDS = 7200
MAX_SEGMENTS = 5000


class MediaError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def probe(path, source_type, ffprobe='ffprobe'):
    try:
        result = subprocess.run([ffprobe, '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', str(path)], capture_output=True, timeout=20, check=True)
        data = json.loads(result.stdout)
    except FileNotFoundError:
        raise MediaError('MEDIA_NOT_CONFIGURED', '전사 환경의 ffmpeg와 ffprobe 설치를 확인해 주세요.')
    except Exception:
        raise MediaError('INVALID_MEDIA', '녹음·동영상 파일을 읽을 수 없습니다. 파일 형식을 확인해 주세요.')
    formats = set(data.get('format', {}).get('format_name', '').split(','))
    if not formats.intersection({'mov', 'mp4', 'm4a', 'mp3', 'wav', 'matroska', 'webm', 'ogg', 'flac'}):
        raise MediaError('INVALID_MEDIA', '지원하는 녹음·동영상 컨테이너가 아닙니다.')
    streams = data.get('streams', [])
    if not any(s.get('codec_type') == 'audio' for s in streams):
        raise MediaError('NO_AUDIO', '이 파일에는 전사할 음성 트랙이 없습니다.')
    if source_type == 'video' and not any(s.get('codec_type') == 'video' and not s.get('disposition', {}).get('attached_pic') for s in streams):
        raise MediaError('INVALID_MEDIA', '동영상 트랙을 확인하지 못했습니다. 녹음 파일 형식으로 올려 주세요.')
    try:
        duration = float(data.get('format', {}).get('duration'))
    except (TypeError, ValueError):
        duration = None
    if duration is not None and math.isfinite(duration) and duration > MAX_SECONDS + .1:
        raise MediaError('MEDIA_TOO_LONG', '녹음·동영상은 120분 이하로 나누어 올려 주세요.')


def normalize(path, output, ffmpeg='ffmpeg'):
    try:
        subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', str(path), '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-t', str(MAX_SECONDS + 1), '-c:a', 'pcm_s16le', '-y', str(output)], capture_output=True, timeout=180, check=True)
        with wave.open(str(output), 'rb') as audio:
            duration = audio.getnframes() / audio.getframerate()
    except FileNotFoundError:
        raise MediaError('MEDIA_NOT_CONFIGURED', '전사 환경의 ffmpeg 설치를 확인해 주세요.')
    except Exception:
        raise MediaError('AUDIO_DECODE_FAILED', '음성 트랙을 변환하지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.')
    if not 0 < duration <= MAX_SECONDS + .1:
        raise MediaError('MEDIA_TOO_LONG', '녹음·동영상은 0초 초과, 120분 이하로 올려 주세요.')
    return duration


def normalize_segments(raw_segments, duration):
    segments = []
    for item in raw_segments:
        start, end, text = float(item.start), float(item.end), item.text.strip()
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start:
            raise MediaError('INVALID_TRANSCRIPT', '전사 결과의 시간 정보를 확인하지 못했습니다.')
        start, end = round(min(start, duration), 3), round(min(end, duration), 3)
        if not text or end <= start:
            continue
        if len(text) > 6000 or len(segments) >= MAX_SEGMENTS:
            raise MediaError('TRANSCRIPT_TOO_LARGE', '전사 결과가 너무 깁니다. 녹음·동영상을 나누어 올려 주세요.')
        segments.append({'start_sec': start, 'end_sec': end, 'text': text})
    if not segments:
        raise MediaError('NO_SPEECH', '인식할 수 있는 음성을 찾지 못했습니다. 음성 구간과 음량을 확인해 주세요.')
    if sum(len(s['text']) for s in segments) > 600000:
        raise MediaError('TRANSCRIPT_TOO_LARGE', '전사 결과가 너무 깁니다. 파일을 나누어 올려 주세요.')
    return segments


def transcribe(path, source_type, model='small', language='auto', cache=None, ffmpeg='ffmpeg', ffprobe='ffprobe'):
    if model not in {'tiny', 'base', 'small', 'medium', 'large-v3'} or not (language == 'auto' or (len(language) == 2 and language.isalpha() and language.islower())):
        raise MediaError('MEDIA_NOT_CONFIGURED', '전사 모델·언어 설정을 확인해 주세요.')
    probe(path, source_type, ffprobe)
    with tempfile.TemporaryDirectory(prefix='campus-stt-') as directory:
        audio = Path(directory) / 'audio.wav'
        duration = normalize(path, audio, ffmpeg)
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            raise MediaError('MEDIA_NOT_CONFIGURED', '전사 환경의 faster-whisper 설치를 확인해 주세요.')
        try:
            recognizer = WhisperModel(model, device='cpu', compute_type='int8', cpu_threads=2, num_workers=1, download_root=cache)
        except Exception:
            raise MediaError('TRANSCRIPTION_MODEL_FAILED', '전사 모델을 준비하지 못했습니다. 모델 다운로드와 저장 공간을 확인해 주세요.')
        try:
            raw, info = recognizer.transcribe(str(audio), language=None if language == 'auto' else language, beam_size=5, vad_filter=True, condition_on_previous_text=False)
            segments = normalize_segments(raw, duration)
        except MediaError:
            raise
        except Exception:
            raise MediaError('TRANSCRIPTION_FAILED', '음성 전사에 실패했습니다. 파일을 확인한 뒤 다시 시도해 주세요.')
        return {'duration_sec': round(duration, 3), 'language': info.language, 'segments': segments}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('file')
    parser.add_argument('--source-type', choices=['audio', 'video'], required=True)
    parser.add_argument('--model', default='small')
    parser.add_argument('--language', default='auto')
    parser.add_argument('--cache-dir')
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('--ffprobe', default='ffprobe')
    args = parser.parse_args()
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ['HF_HUB_DISABLE_PROGRESS_BARS'] = '1'
    try:
        result = transcribe(args.file, args.source_type, args.model, args.language, args.cache_dir, args.ffmpeg, args.ffprobe)
        print(json.dumps(result, ensure_ascii=False))
    except MediaError as error:
        print(json.dumps({'code': error.code, 'error': str(error)}, ensure_ascii=False))
        return 1
    except Exception:
        print(json.dumps({'code': 'TRANSCRIPTION_FAILED', 'error': '전사를 완료하지 못했습니다. 전사 환경과 파일을 확인해 주세요.'}, ensure_ascii=False))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
