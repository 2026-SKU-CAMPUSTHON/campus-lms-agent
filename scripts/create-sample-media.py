"""Codec fixture only: generated tone is not a real lecture or ASR quality sample."""
from pathlib import Path
import math
import struct
import wave
root = Path(__file__).resolve().parents[1] / 'tests/fixtures/generated'
root.mkdir(parents=True, exist_ok=True)
with wave.open(str(root / 'sample-tone.wav'), 'wb') as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(16000)
    output.writeframes(b''.join(struct.pack('<h', int(1500 * math.sin(2 * math.pi * 440 * i / 16000))) for i in range(80000)))
