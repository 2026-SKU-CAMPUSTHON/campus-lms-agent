"""Codec/time/error checks. CI uses no downloaded speech model."""
from pathlib import Path
from types import SimpleNamespace
import shutil
import subprocess
import tempfile
import unittest
import wave
from transcribe_media import probe, normalize, normalize_segments, MediaError


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'ffmpeg required')
class MediaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name)
        self.wav = self.path / 'test.wav'
        with wave.open(str(self.wav), 'wb') as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(8000)
            audio.writeframes(b'\0\0' * 8000)

    def tearDown(self):
        self.tmp.cleanup()

    def test_real_wav_and_video_audio_decode(self):
        probe(self.wav, 'audio')
        self.assertAlmostEqual(normalize(self.wav, self.path / 'out.wav'), 1, places=2)
        video = self.path / 'test.mp4'
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=32x32:r=1', '-i', str(self.wav), '-c:v', 'libx264', '-c:a', 'aac', '-shortest', str(video)], check=True)
        probe(video, 'video')
        self.assertAlmostEqual(normalize(video, self.path / 'video.wav'), 1, delta=.15)

    def test_no_audio_and_corrupt_input_fail(self):
        video = self.path / 'silent.mp4'
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=32x32:r=1', '-t', '1', '-c:v', 'libx264', str(video)], check=True)
        with self.assertRaises(MediaError) as error:
            probe(video, 'video')
        self.assertEqual(error.exception.code, 'NO_AUDIO')
        fake = self.path / 'fake.mp4'
        fake.write_text('not a media file')
        with self.assertRaises(MediaError) as error:
            probe(fake, 'video')
        self.assertEqual(error.exception.code, 'INVALID_MEDIA')

    def test_missing_binary_is_configuration_error(self):
        with self.assertRaises(MediaError) as error:
            probe(self.wav, 'audio', str(self.path / 'missing-ffprobe'))
        self.assertEqual(error.exception.code, 'MEDIA_NOT_CONFIGURED')


class SegmentTests(unittest.TestCase):
    def test_bounded_time_and_empty_speech(self):
        segment = SimpleNamespace(start=0, end=12, text='실제 파일 길이에 맞춥니다.')
        self.assertEqual(normalize_segments([segment], 10)[0]['end_sec'], 10)
        with self.assertRaises(MediaError) as error:
            normalize_segments([], 10)
        self.assertEqual(error.exception.code, 'NO_SPEECH')

    def test_invalid_timestamps(self):
        for start, end in [(-1, 2), (4, 2), (float('nan'), 3)]:
            with self.assertRaises(MediaError) as error:
                normalize_segments([SimpleNamespace(start=start, end=end, text='invalid')], 10)
            self.assertEqual(error.exception.code, 'INVALID_TRANSCRIPT')


if __name__ == '__main__':
    unittest.main()
