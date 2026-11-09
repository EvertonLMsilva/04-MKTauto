"""Contract tests with a controlled ctypes library; no real voice is executed."""
import ctypes as c
import hashlib
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import MagicMock, Mock, patch
import wave

import espeak
from espeak import main


class NativeSpeechTest(unittest.TestCase):
    def test_rejects_unapproved_voices_rates_and_oversize_without_loading_library(self):
        for text, voice, rate in [
            (b'text', 'mb-br1', 150),
            (b'text', 'pt-br', 300),
            (b'x' * 65537, 'pt-br', 150),
        ]:
            with (patch('sys.stdin', Mock(buffer=io.BytesIO(text))),
                  patch('ctypes.CDLL') as dll):
                with self.assertRaises(ValueError):
                    main(Path('.'), Path('unused.wav'), voice, rate)
                dll.assert_not_called()

    def test_real_callback_bytes_are_written_as_pcm_with_fixed_native_voice(self):
        with tempfile.TemporaryDirectory() as directory:
            lib = Mock()
            lib.espeak_Initialize.return_value = 22050
            lib.espeak_SetVoiceByName.return_value = 0
            lib.espeak_SetParameter.return_value = 0
            callback = []
            lib.espeak_SetSynthCallback.side_effect = callback.append
            samples = (c.c_short * 22050)(*([100] * 22050))

            def synth(*_args):
                callback[0](samples, 22050, None)
                return 0

            lib.espeak_Synth.side_effect = synth
            lib.espeak_Synchronize.return_value = 0
            output = Path(directory) / 'out.wav'
            with (patch('sys.stdin', Mock(buffer=io.BytesIO(
                    'Conheça este produto.'.encode()))),
                  patch('sys.platform', 'win32'),
                  patch('ctypes.CDLL', return_value=lib)):
                main(Path(directory), output)
            with wave.open(str(output)) as wav:
                self.assertEqual(
                    (wav.getnchannels(), wav.getsampwidth(),
                     wav.getframerate(), wav.getnframes()),
                    (1, 2, 22050, 22050),
                )
            lib.espeak_SetVoiceByName.assert_called_once_with(b'pt-br')
            lib.espeak_SetParameter.assert_called_once_with(1, 150, 0)
            lib.espeak_Terminate.assert_called_once()


class EspeakPlatformTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mktauto-espeak-contract-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.output = self.root / 'controlled.wav'
        self.library = self.root / 'libespeak-ng.so.1.1.51'
        self.executable = self.root / 'espeak-ng'
        self.library.write_bytes(b'CONTROLLED_LIBRARY_NOT_REAL_SPEECH')
        self.executable.write_bytes(b'CONTROLLED_EXECUTABLE')
        self.native = dict(
            platform='linux', architecture='x64', version='1.51',
            libraryPath=str(self.library),
            librarySha256=self.digest(self.library),
            executablePath=str(self.executable),
            executableSha256=self.digest(self.executable),
        )
        self.lib = MagicMock()
        self.lib.espeak_Info.return_value = b'1.51'
        self.lib.espeak_Initialize.return_value = 24000
        self.lib.espeak_SetVoiceByName.return_value = 0
        self.lib.espeak_SetParameter.return_value = 0
        self.lib.espeak_Synchronize.return_value = 0
        callbacks = []
        self.lib.espeak_SetSynthCallback.side_effect = callbacks.append

        def synthesize(*_args):
            samples = (espeak.c.c_short * 8)(*[100] * 8)
            callbacks[0](samples, 8, None)
            return 0

        self.lib.espeak_Synth.side_effect = synthesize
        self.loader = MagicMock(return_value=self.lib)
        self.addCleanup(patch.stopall)
        patch.object(espeak.c, 'CDLL', self.loader).start()
        patch.object(espeak.platform, 'machine', return_value='x86_64').start()
        self.system = types.SimpleNamespace(
            platform='linux',
            stdin=types.SimpleNamespace(buffer=io.BytesIO(b'Texto original.')),
        )
        patch.object(espeak, 'sys', self.system).start()
        patch.object(espeak, 'os', types.SimpleNamespace(name='posix')).start()

    @staticmethod
    def digest(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def invoke(self, **overrides):
        native = json.loads(json.dumps({**self.native, **overrides}))
        return espeak.main(self.root, self.output, 'pt-br', 150, native)

    def test_linux_loads_only_the_explicit_pinned_library_and_preserves_wav(self):
        self.invoke()
        self.loader.assert_called_once_with(str(self.library))
        self.lib.espeak_SetVoiceByName.assert_called_once_with(b'pt-br')
        self.lib.espeak_SetParameter.assert_called_once_with(1, 150, 0)
        with wave.open(str(self.output), 'rb') as wav:
            self.assertEqual(
                (wav.getframerate(), wav.getnchannels(),
                 wav.getsampwidth(), wav.getnframes()),
                (24000, 1, 2, 8),
            )

    def test_windows_legacy_keeps_its_dll_and_parameters(self):
        self.system.platform = 'win32'
        directory = MagicMock()
        espeak.os = types.SimpleNamespace(
            name='nt', add_dll_directory=MagicMock(return_value=directory),
        )
        espeak.main(self.root, self.output, 'pt-br', 140)
        self.loader.assert_called_once_with(str(self.root / 'espeak-ng.dll'))
        self.lib.espeak_Info.assert_not_called()
        self.lib.espeak_SetParameter.assert_called_once_with(1, 140, 0)
        directory.close.assert_called_once()

    def test_linux_requires_explicit_authorization_metadata(self):
        with self.assertRaises(ValueError):
            espeak.main(self.root, self.output)
        self.loader.assert_not_called()

    def test_library_hash_mismatch_blocks_before_loading(self):
        self.library.write_bytes(b'TAMPERED')
        with self.assertRaises(ValueError):
            self.invoke()
        self.loader.assert_not_called()

    def test_executable_hash_mismatch_blocks_before_loading(self):
        self.executable.write_bytes(b'TAMPERED')
        with self.assertRaises(ValueError):
            self.invoke()
        self.loader.assert_not_called()

    def test_binary_version_mismatch_blocks_before_synthesis(self):
        self.lib.espeak_Info.return_value = b'1.52.0.1'
        with self.assertRaises(ValueError):
            self.invoke()
        self.lib.espeak_Synth.assert_not_called()

    def test_native_platform_mismatch_blocks_before_loading(self):
        with self.assertRaises(ValueError):
            self.invoke(platform='win32')
        self.loader.assert_not_called()

    def test_native_architecture_mismatch_blocks_before_loading(self):
        with self.assertRaises(ValueError):
            self.invoke(architecture='arm64')
        self.loader.assert_not_called()

    def test_unsupported_host_blocks_before_loading(self):
        self.system.platform = 'darwin'
        with self.assertRaises(ValueError):
            self.invoke()
        self.loader.assert_not_called()

    def test_relative_or_unapproved_library_blocks_before_loading(self):
        with self.assertRaises(ValueError):
            self.invoke(libraryPath='libespeak-ng.so')
        self.loader.assert_not_called()

    def test_incomplete_manifest_blocks_before_loading(self):
        del self.native['librarySha256']
        with self.assertRaises(ValueError):
            self.invoke()
        self.loader.assert_not_called()

    def test_voice_or_rate_cannot_be_changed_silently(self):
        for voice, rate in [('pf_dora', 150), ('pt-br', 200)]:
            with self.assertRaises(ValueError):
                espeak.main(self.root, self.output, voice, rate, self.native)
        self.loader.assert_not_called()


if __name__ == '__main__':
    unittest.main()
