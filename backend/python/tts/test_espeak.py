import ctypes as c
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import wave
from espeak import main


class NativeSpeechTest(unittest.TestCase):
    def test_rejects_unapproved_voices_rates_and_oversize_without_loading_library(self):
        for text, voice, rate in [(b'text', 'mb-br1', 150), (b'text', 'pt-br', 300), (b'x' * 65537, 'pt-br', 150)]:
            with patch('sys.stdin', Mock(buffer=io.BytesIO(text))), patch('ctypes.CDLL') as dll:
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
            def synth(*args):
                callback[0](samples, 22050, None)
                return 0
            lib.espeak_Synth.side_effect = synth
            lib.espeak_Synchronize.return_value = 0
            output = Path(directory) / 'out.wav'
            with patch('sys.stdin', Mock(buffer=io.BytesIO('Conheça este produto.'.encode()))), patch('ctypes.CDLL', return_value=lib):
                main(Path(directory), output)
            with wave.open(str(output)) as wav:
                self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()), (1, 2, 22050, 22050))
            lib.espeak_SetVoiceByName.assert_called_once_with(b'pt-br')
            lib.espeak_SetParameter.assert_called_once_with(1, 150, 0)
            lib.espeak_Terminate.assert_called_once()


if __name__ == '__main__':
    unittest.main()
