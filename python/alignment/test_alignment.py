import math
import unittest
import hashlib
import tempfile
from align import viterbi, script_tokens, segments, check_transcript, verify_model
from pathlib import Path


class AlignmentTests(unittest.TestCase):
    def test_affiliate_disclosure_separator_preserves_text_and_offsets(self):
        text = 'Ação. Publicidade | Link de afiliado.'
        vocab = {c: i for i, c in enumerate('abcdefghijklmnopqrstuvwxyzáéíóúâêôãõç|')}
        ids, words = script_tokens(text, vocab, 'pt-br-written/1')
        self.assertEqual(''.join(list(vocab)[i] for i in ids),
                         'ação|publicidade|link|de|afiliado')
        cues = segments(text, words, [(i, i + 1) for i in range(len(ids))], 20)
        self.assertEqual(' '.join(cue['text'] for cue in cues), text)
        self.assertEqual(cues[1]['text'], 'Publicidade |')
        self.assertEqual(cues[1]['textEndOffset'], text.index(' |') + 2)
        self.assertEqual(cues[2]['textStartOffset'], text.index('Link'))
        with self.assertRaisesRegex(ValueError, 'UNSUPPORTED'):
            script_tokens(text, vocab)
        for unsupported in ('| Publicidade', 'Publicidade || Link', 'Publicidade |Link'):
            with self.subTest(unsupported=unsupported):
                with self.assertRaisesRegex(ValueError, 'UNSUPPORTED'):
                    script_tokens(unsupported, vocab, 'pt-br-written/1')

    def test_portuguese_written_numbers_and_separators_preserve_exact_offsets(self):
        text = 'Kit 7 e 14. Publicidade · Cena ilustrativa · material_declarado: plástico.'
        vocab = {c: i for i, c in enumerate('abcdefghijklmnopqrstuvwxyzáéíóúâêôãõç|')}
        ids, words = script_tokens(text, vocab, 'pt-br-written/1')
        acoustic = ''.join(list(vocab)[i] for i in ids)
        self.assertIn('kit|sete|e|catorze', acoustic)
        self.assertIn('material|declarado', acoustic)
        result = segments(text, words, [(i, i + 1) for i in range(len(ids))], 20)
        self.assertEqual(' '.join(s['text'] for s in result), text)
        with self.assertRaisesRegex(ValueError, 'UNSUPPORTED'):
            script_tokens('Kit 7', vocab)
        with self.assertRaisesRegex(ValueError, 'UNSUPPORTED'):
            script_tokens('Kit 1234', vocab, 'pt-br-written/1')

    def test_acoustic_path_and_repeated_labels(self):
        emissions = [[math.log(x) for x in row] for row in
                     [[.1, .9, .0 + 1e-8], [.9, .1, 1e-8], [.1, .9, 1e-8], [.9, .1, 1e-8]]]
        self.assertEqual(viterbi(emissions, [1, 1], 0), [(0, 1), (2, 3)])

    def test_incomplete_and_silence(self):
        with self.assertRaisesRegex(ValueError, 'INCOMPLETE'):
            viterbi([[0., -10.]], [1, 1], 0)
        with self.assertRaisesRegex(ValueError, 'CONFIDENCE'):
            viterbi([[0., -10.]] * 10, [1], 0)

    def test_utf16_accents_punctuation(self):
        text = 'Olá, ação!'
        vocab = {c: i for i, c in enumerate('OLÁ|AÇÃO')}
        ids, words = script_tokens(text, vocab)
        self.assertEqual(len(ids), 8)
        result = segments(text, words, [(i * 2, i * 2 + 1) for i in range(8)], 20)
        self.assertEqual([s['text'] for s in result], ['Olá,', 'ação!'])
        self.assertEqual(result[1]['textStartOffset'], 5)
        with self.assertRaisesRegex(ValueError, 'UNSUPPORTED'):
            script_tokens('Olá 😀', vocab)

    def test_divergence(self):
        with self.assertRaisesRegex(ValueError, 'DIVERGENT'):
            check_transcript([1, 2, 3], [4, 5, 6])
        check_transcript([1, 2, 3], [1, 2, 3])

    def test_missing_model(self):
        with self.assertRaisesRegex(ValueError, 'MODEL_UNAVAILABLE'):
            verify_model(Path('missing-model'), '0' * 64)

    def test_model_manifest_tamper(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'manifest.json').write_text('{}', 'utf-8')
            with self.assertRaisesRegex(ValueError, 'MODEL_TAMPERED'):
                verify_model(root, '0' * 64)
            with self.assertRaisesRegex(ValueError, 'MODEL_INCOMPATIBLE'):
                verify_model(root, hashlib.sha256(b'{}').hexdigest())

    def test_actual_lowercase_vocabulary_and_decomposed_accent(self):
        text = 'Ola\u0301, ação!'
        vocab = {char: i for i, char in enumerate('olá|açã')}
        ids, words = script_tokens(text, vocab)
        result = segments(text, words, [(i, i + 1) for i in range(len(ids))], 20)
        self.assertEqual(result[0]['text'], 'Ola\u0301,')
        self.assertEqual(result[1]['textStartOffset'], 6)


if __name__ == '__main__':
    unittest.main()
