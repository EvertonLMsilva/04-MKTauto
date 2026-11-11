"""Offline native pt-BR formant synthesis. No sampled/MBROLA voice or network."""
import ctypes as c
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import sys
import wave


def native_library(root, native):
    if native is None:
        if sys.platform != 'win32':
            raise ValueError('LOCAL_TTS_LICENSE_REQUIRED')
        return root / 'espeak-ng.dll'
    keys = {'platform', 'architecture', 'version', 'libraryPath', 'librarySha256',
            'executablePath', 'executableSha256'}
    architecture = {'x86_64': 'x64', 'amd64': 'x64', 'aarch64': 'arm64',
                    'arm64': 'arm64'}.get(platform.machine().lower())
    if (not isinstance(native, dict) or set(native) != keys
            or sys.platform != 'linux' or native['platform'] != 'linux'
            or native['architecture'] not in ('x64', 'arm64')
            or native['architecture'] != architecture
            or not isinstance(native['version'], str)
            or not re.fullmatch(r'[a-zA-Z0-9_.:/-]{1,100}', native['version'])):
        raise ValueError('LOCAL_TTS_LICENSE_REQUIRED')
    for name in ('library', 'executable'):
        location, digest = native[name + 'Path'], native[name + 'Sha256']
        if not isinstance(location, str) or not isinstance(digest, str):
            raise ValueError('LOCAL_TTS_LICENSE_REQUIRED')
        path = Path(location)
        if (not path.is_absolute() or not path.is_file() or path.is_symlink()
                or path.resolve() != path or path.stat().st_size > 536870912
                or not re.fullmatch(r'[a-f0-9]{64}', digest)
                or hashlib.sha256(path.read_bytes()).hexdigest() != digest):
            raise ValueError('LOCAL_TTS_LICENSE_REQUIRED')
    return Path(native['libraryPath'])


def main(root, output, voice='pt-br', rate_words=150, native=None):
    text = sys.stdin.buffer.read(65537)
    if not text or len(text) > 65536:
        raise ValueError('LOCAL_TTS_INPUT_INVALID')
    text.decode('utf-8', errors='strict')
    if voice not in ['pt-br', 'pt-br+m1', 'pt-br+m3', 'pt-br+f2', 'pt-br+f3']:
        raise ValueError('LOCAL_TTS_VOICE_INVALID')
    if rate_words not in [140, 150, 160]:
        raise ValueError('LOCAL_TTS_RATE_INVALID')
    library = native_library(root, native)
    directory = os.add_dll_directory(str(root)) if os.name == 'nt' else None
    try:
        return synthesize(root, output, text, voice, rate_words, library, native)
    finally:
        if directory:
            directory.close()


def synthesize(root, output, text, voice, rate_words, library, native):
    lib = c.CDLL(str(library))
    if native is not None:
        lib.espeak_Info.argtypes = [c.POINTER(c.c_char_p)]
        lib.espeak_Info.restype = c.c_char_p
        version = lib.espeak_Info(None)
        tokens = version.decode('ascii').split() if version else []
        if not tokens or tokens[0] != native['version']:
            raise ValueError('LOCAL_TTS_LICENSE_REQUIRED')
    lib.espeak_Initialize.argtypes = [c.c_int, c.c_int, c.c_char_p, c.c_int]
    lib.espeak_SetVoiceByName.argtypes = [c.c_char_p]
    lib.espeak_Synth.argtypes = [
        c.c_void_p, c.c_size_t, c.c_uint, c.c_int,
        c.c_uint, c.c_uint, c.c_void_p, c.c_void_p,
    ]
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
        if (lib.espeak_SetVoiceByName(voice.encode('ascii')) != 0
                or lib.espeak_SetParameter(1, rate_words, 0) != 0):
            raise ValueError('LOCAL_TTS_VOICE_INVALID')
        data = c.create_string_buffer(text + b'\0')
        if (lib.espeak_Synth(data, len(text) + 1, 0, 1, 0, 1, None, None) != 0
                or lib.espeak_Synchronize() != 0
                or not chunks or size > 20971520):
            raise ValueError('LOCAL_TTS_EXECUTION_REQUIRED')
        with wave.open(str(output), 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes(b''.join(chunks))
    finally:
        lib.espeak_Terminate()


if __name__ == '__main__':
    if not 3 <= len(sys.argv) <= 6:
        raise ValueError('LOCAL_TTS_INPUT_INVALID')
    main(Path(sys.argv[1]).resolve(), Path(sys.argv[2]),
         sys.argv[3] if len(sys.argv) >= 4 else 'pt-br',
         int(sys.argv[4]) if len(sys.argv) >= 5 else 150,
         json.loads(sys.argv[5]) if len(sys.argv) == 6 else None)
