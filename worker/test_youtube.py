"""No YouTube requests or ASR model downloads in CI."""
import math
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
import import_youtube as youtube
from transcribe_media import MediaError

VIDEO = 'XwsPTAnFRsk'


class YouTubeTests(unittest.TestCase):
    def test_metadata_rejects_live_long_and_out_of_range(self):
        base = {'id': VIDEO, 'duration': 2819, 'live_status': 'not_live'}
        self.assertEqual(youtube.validate_range(base, VIDEO, 732, None), (2819, 2819))
        for change, start, end in [({'is_live': True}, 0, None), ({'duration': 7201}, 0, None), ({'duration': float('nan')}, 0, None), ({'id': 'wrong'}, 0, None), ({}, 2819, None), ({}, 732, 4000), ({}, -1, 1)]:
            with self.assertRaises(MediaError):
                youtube.validate_range({**base, **change}, VIDEO, start, end)

    def test_captions_keep_original_time_clip_overlap_and_drop_outside(self):
        raw = [SimpleNamespace(start=700, duration=10, text='범위 밖'), SimpleNamespace(start=730, duration=10, text='<b>첫 자막</b> &amp; 근거'), SimpleNamespace(start=750, duration=100, text='마지막 자막'), SimpleNamespace(start=900, duration=10, text='범위 밖')]
        self.assertEqual(youtube.caption_segments(raw, 732, 800), [{'start_sec': 732, 'end_sec': 740, 'text': '첫 자막 & 근거'}, {'start_sec': 750, 'end_sec': 800, 'text': '마지막 자막'}])
        with self.assertRaises(MediaError):
            youtube.caption_segments([SimpleNamespace(start=math.nan, duration=1, text='잘못된 시간')], 0, 10)

    def test_caption_success_never_downloads_audio_missing_captions_use_asr(self):
        downloader = MagicMock()
        downloader.__enter__.return_value.extract_info.return_value = {'id': VIDEO, 'duration': 1000, 'title': '테스트 강의'}
        modules = {'yt_dlp': SimpleNamespace(YoutubeDL=lambda _: downloader), 'youtube_transcript_api': types.ModuleType('youtube_transcript_api')}
        captions = {'language': 'ko', 'is_generated': True, 'segments': [{'start_sec': 732, 'end_sec': 740, 'text': '테스트 근거'}]}
        with patch.dict(sys.modules, modules), patch.object(youtube, 'fetch_captions', return_value=captions), patch.object(youtube, 'audio_transcript') as audio:
            result = youtube.import_youtube(VIDEO, 732, 800)
            self.assertEqual(result['method'], 'captions')
            audio.assert_not_called()
        with patch.dict(sys.modules, modules), patch.object(youtube, 'fetch_captions', return_value=None), patch.object(youtube, 'audio_transcript', return_value={'duration_sec': 68, 'language': 'ko', 'segments': captions['segments']}) as audio:
            result = youtube.import_youtube(VIDEO, 732, 800)
            self.assertEqual(result['method'], 'audio')
            self.assertEqual(result['transcription']['duration_sec'], 1000)
            self.assertEqual(audio.call_args.args[1:3], (732, 800))

    def test_error_messages_hide_signed_urls_and_upstream_details(self):
        error = youtube.fetch_error(Exception('Sign in to confirm not a bot https://secret.test?token=sensitive'))
        self.assertEqual(error.code, 'YOUTUBE_ACCESS_BLOCKED')
        self.assertNotIn('sensitive', str(error))

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg required')
    def test_audio_crop_restores_absolute_timestamps(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.wav'
            with wave.open(str(source), 'wb') as audio:
                audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(16000); audio.writeframes(b'\0\0' * 16000 * 5)
            def fake_transcribe(path, *_):
                with wave.open(str(path), 'rb') as decoded:
                    self.assertAlmostEqual(decoded.getnframes() / decoded.getframerate(), 2, places=2)
                return {'duration_sec': 2, 'language': 'ko', 'segments': [{'start_sec': .2, 'end_sec': 1.8, 'text': '테스트 음성 근거'}]}
            with patch.object(youtube, 'download_audio', return_value=source), patch.object(youtube, 'transcribe', side_effect=fake_transcribe):
                result = youtube.audio_transcript('https://www.youtube.com/watch?v='+VIDEO, 2, 4, 'small', 'auto', None, 'ffmpeg', 'ffprobe')
            self.assertEqual(result['segments'][0]['start_sec'], 2.2)
            self.assertEqual(result['segments'][0]['end_sec'], 3.8)


if __name__ == '__main__':
    unittest.main()
