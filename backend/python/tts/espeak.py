"""Offline native pt-BR formant synthesis. No sampled/MBROLA voice or network."""
import ctypes as c
import os
from pathlib import Path
import sys
import wave


def main(root, output, voice='pt-br', rate_words=150):
    text = sys.stdin.buffer.read(65537)
    if not text or len(text) > 65536:
        raise ValueError('LOCAL_TTS_INPUT_INVALID')
    text.decode('utf-8', errors='strict')
    if voice not in ['pt-br', 'pt-br+m1', 'pt-br+m3', 'pt-br+f2', 'pt-br+f3']:
        raise ValueError('LOCAL_TTS_VOICE_INVALID')
    if rate_words not in [140, 150, 160]:
        raise ValueError('LOCAL_TTS_RATE_INVALID')
    directory = os.add_dll_directory(str(root)) if os.name == 'nt' else None
    lib = c.CDLL(str(root / 'espeak-ng.dll'))
    lib.espeak_Initialize.argtypes = [c.c_int, c.c_int, c.c_char_p, c.c_int]
    lib.espeak_SetVoiceByName.argtypes = [c.c_char_p]
    lib.espeak_Synth.argtypes = [c.c_void_p, c.c_size_t, c.c_uint, c.c_int, c.c_uint, c.c_uint, c.c_void_p, c.c_void_p]
    chunks = []
    size = 0

    @c.CFUNCTYPE(c.c_int, c.POINTER(c.c_short), c.c_int, c.c_void_p)
    def receive(samples, count, events):
        nonlocal size
        size += max(count, 0) * 2
        if size > 20971520:
            return 1
        if samples and count > 0:
            chunks.append(c.string_at(samples, count * 2))
        return 0

    rate = lib.espeak_Initialize(1, 0, str(root).encode('utf-8'), 0)
    if rate < 8000 or rate > 96000:
        raise ValueError('LOCAL_TTS_ENGINE_INVALID')
    lib.espeak_SetSynthCallback(receive)
    try:
        if lib.espeak_SetVoiceByName(voice.encode('ascii')) != 0 or lib.espeak_SetParameter(1, rate_words, 0) != 0:
            raise ValueError('LOCAL_TTS_VOICE_INVALID')
        data = c.create_string_buffer(text + b'\0')
        if lib.espeak_Synth(data, len(text) + 1, 0, 1, 0, 1, None, None) != 0 or lib.espeak_Synchronize() != 0 or not chunks or size > 20971520:
            raise ValueError('LOCAL_TTS_EXECUTION_REQUIRED')
        with wave.open(str(output), 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes(b''.join(chunks))
    finally:
        lib.espeak_Terminate()
        if directory:
            directory.close()


if __name__ == '__main__':
    main(Path(sys.argv[1]).resolve(), Path(sys.argv[2]), sys.argv[3] if len(sys.argv) >= 4 else 'pt-br', int(sys.argv[4]) if len(sys.argv) == 5 else 150)
