"""Offline Dora natural adapter. All files are pinned by the NestJS caller."""
import os
import pathlib
import sys

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
sys.stdin.reconfigure(encoding='utf-8')

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

model, voices, output = map(pathlib.Path, sys.argv[1:])
if not model.is_file() or not voices.is_file():
    raise ValueError('LOCAL_TTS_MODEL_REQUIRED')
text = sys.stdin.read(65537).strip()
if not text or len(text) > 6000:
    raise ValueError('LOCAL_TTS_INPUT_INVALID')
engine = Kokoro(str(model), str(voices))
audio, rate = engine.create(text, voice='pf_dora', lang='pt-br', speed=1.0,
                            sentence_pause=0.25)
if rate != 24000 or not np.isfinite(audio).all() or np.max(np.abs(audio)) < 0.001:
    raise ValueError('LOCAL_TTS_AUDIO_INVALID')
sf.write(str(output), audio, rate, subtype='PCM_16')
