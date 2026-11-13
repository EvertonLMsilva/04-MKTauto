"""Offline Portuguese CTC alignment. No remote code, proportional timing or ASR APIs."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import time
import unicodedata
import wave

MODEL = 'jonatasgrosman/wav2vec2-large-xlsr-53-portuguese'
REVISION = '634ac655299bcdc46c83bc01da9bab52d2987e4f'
ALGORITHM = 'ctc-viterbi-1'


def fail(code):
    raise ValueError(code)


def verify_model(root, manifest_hash):
    try:
        raw = (root / 'manifest.json').read_bytes()
    except OSError:
        fail('ALIGNMENT_MODEL_UNAVAILABLE')
    if hashlib.sha256(raw).hexdigest() != manifest_hash:
        fail('ALIGNMENT_MODEL_TAMPERED')
    try:
        manifest = json.loads(raw)
    except (ValueError, TypeError):
        fail('ALIGNMENT_MODEL_INCOMPATIBLE')
    required = {'config.json', 'preprocessor_config.json', 'vocab.json',
                'special_tokens_map.json', 'pytorch_model.bin'}
    if (not isinstance(manifest, dict) or manifest.get('model') != MODEL
            or manifest.get('revision') != REVISION or not isinstance(manifest.get('files'), dict)
            or not required.issubset(manifest['files'])):
        fail('ALIGNMENT_MODEL_INCOMPATIBLE')
    for name, expected in manifest['files'].items():
        if Path(name).name != name:
            fail('ALIGNMENT_MODEL_INCOMPATIBLE')
        digest = hashlib.sha256()
        try:
            with (root / name).open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
        except OSError:
            fail('ALIGNMENT_MODEL_UNAVAILABLE')
        if digest.hexdigest() != expected:
            fail('ALIGNMENT_MODEL_TAMPERED')
    import importlib.metadata as metadata
    try:
        environment = (root / 'environment.json').read_bytes()
    except OSError:
        fail('ALIGNMENT_ENVIRONMENT_UNAVAILABLE')
    if hashlib.sha256(environment).hexdigest() != manifest.get('environmentSha256'):
        fail('ALIGNMENT_ENVIRONMENT_TAMPERED')
    for package in json.loads(environment)['packages']:
        try:
            version = metadata.version(package['name'])
        except metadata.PackageNotFoundError:
            fail('ALIGNMENT_ENVIRONMENT_INCOMPATIBLE')
        if version != package['version']:
            fail('ALIGNMENT_ENVIRONMENT_INCOMPATIBLE')
    return manifest


def spoken_integer(match):
    # Bounded written-to-spoken expansion, never a timestamp approximation.
    raw = match[0]
    if len(raw) > 2 or (len(raw) > 1 and raw.startswith('0')):
        fail('ALIGNMENT_TEXT_UNSUPPORTED')
    n = int(raw)
    units = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete',
             'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze',
             'dezesseis', 'dezessete', 'dezoito', 'dezenove']
    tens = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta',
            'setenta', 'oitenta', 'noventa']
    return units[n] if n < 20 else tens[n // 10] + (' e ' + units[n % 10] if n % 10 else '')


def script_tokens(text, vocab, text_policy='strict/1'):
    if text_policy not in ('strict/1', 'pt-br-written/1'):
        fail('ALIGNMENT_TEXT_UNSUPPORTED')
    if not text.strip() or len(text.encode('utf-16-le')) > 12000:
        fail('ALIGNMENT_TEXT_INVALID')
    tokens, words = [], []
    for match in re.finditer(r'\S+', text):
        surface = unicodedata.normalize('NFC', match[0])
        if text_policy == 'pt-br-written/1':
            # Display-only disclosure separators stay in the prior cue's exact
            # text span; they are not phonemes or additional timed words.
            if surface in ('·', '|') and words:
                a, _, first, last = words[-1]
                words[-1] = (a, match.end(), first, last)
                continue
            surface = re.sub(r'(?<![\w.,])\d+(?![\w.,]\d)', spoken_integer, surface)
            surface = surface.replace('_', ' ')
        start = len(tokens)
        if words:
            if '|' not in vocab:
                fail('ALIGNMENT_TEXT_UNSUPPORTED')
            tokens.append(vocab['|'])
            start += 1
        for char in surface:
            if char == ' ' and text_policy == 'pt-br-written/1':
                tokens.append(vocab['|'])
                continue
            if char.isalpha() or char.isdigit():
                normalized = char.lower() if char.lower() in vocab else char.upper()
                if len(normalized) != 1 or normalized not in vocab:
                    fail('ALIGNMENT_TEXT_UNSUPPORTED')
                tokens.append(vocab[normalized])
            elif char not in '.,!?;:…—–-"\'“”‘’()[]«»':
                fail('ALIGNMENT_TEXT_UNSUPPORTED')
        if len(tokens) == start:
            fail('ALIGNMENT_TEXT_UNSUPPORTED')
        words.append((match.start(), match.end(), start, len(tokens)))
    return tokens, words


def check_transcript(target, decoded):
    # Independent greedy acoustic transcript gate: forced paths alone cannot detect divergence.
    previous = list(range(len(decoded) + 1))
    for i, token in enumerate(target):
        row = [i + 1]
        for j, other in enumerate(decoded):
            row.append(min(row[-1] + 1, previous[j + 1] + 1,
                           previous[j] + (token != other)))
        previous = row
    cer = previous[-1] / max(1, len(target))
    if cer > .25:
        fail('ALIGNMENT_TEXT_DIVERGENT')
    return cer


def viterbi(emissions, tokens, blank):
    frames = len(emissions)
    states = [blank]
    for token in tokens:
        if token == blank:
            fail('ALIGNMENT_TEXT_UNSUPPORTED')
        states.extend([token, blank])
    width = len(states)
    if not tokens or frames < len(tokens) or frames * width > 20000000:
        fail('ALIGNMENT_INCOMPLETE')
    prev = [-math.inf] * width
    prev[0] = 0.
    trace = bytearray(frames * width)
    for t, row in enumerate(emissions):
        current = [-math.inf] * width
        for s, token in enumerate(states):
            options = [(prev[s], 0)]
            if s:
                options.append((prev[s - 1], 1))
            if s > 1 and token != blank and token != states[s - 2]:
                options.append((prev[s - 2], 2))
            score, step = max(options)
            current[s] = score + float(row[token])
            trace[t * width + s] = step
        prev = current
    s = width - 1 if prev[-1] >= prev[-2] else width - 2
    if not math.isfinite(prev[s]):
        fail('ALIGNMENT_INCOMPLETE')
    spans = [[] for _ in tokens]
    scores = []
    for t in range(frames - 1, -1, -1):
        if s % 2:
            spans[s // 2].append(t)
            scores.append(float(emissions[t][states[s]]))
        s -= trace[t * width + s]
    if any(not span for span in spans):
        fail('ALIGNMENT_INCOMPLETE')
    if sum(scores) / len(scores) < math.log(.05):
        fail('ALIGNMENT_LOW_CONFIDENCE')
    return [(min(span), max(span) + 1) for span in spans]


def segments(text, words, spans, stride_ms):
    result = []
    for start, end, first, last in words:
        a, b = round(spans[first][0] * stride_ms), round(spans[last - 1][1] * stride_ms)
        if b <= a:
            fail('ALIGNMENT_INCOMPLETE')
        result.append(dict(startMs=a, endMs=b, text=text[start:end],
                           textStartOffset=len(text[:start].encode('utf-16-le')) // 2,
                           textEndOffset=len(text[:end].encode('utf-16-le')) // 2))
    return result


def run(request, root, manifest_hash):
    started = time.monotonic()
    verify_model(root, manifest_hash)
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
    import numpy as np
    import torch
    from scipy.signal import resample_poly
    from transformers import Wav2Vec2Processor, Wav2Vec2ForCTC
    torch.set_num_threads(2)
    torch.manual_seed(0)
    torch.use_deterministic_algorithms(True)
    audio_path = Path(request['audioPath'])
    raw = audio_path.read_bytes()
    if len(raw) > 20971520 or hashlib.sha256(raw).hexdigest() != request['input']['audioSha256']:
        fail('ALIGNMENT_AUDIO_HASH_MISMATCH')
    try:
        with wave.open(str(audio_path), 'rb') as wav:
            rate, channels, count = wav.getframerate(), wav.getnchannels(), wav.getnframes()
            if wav.getsampwidth() != 2 or channels not in (1, 2) or not 8000 <= rate <= 96000:
                fail('ALIGNMENT_AUDIO_INCOMPATIBLE')
            if not 0 < count / rate <= 60:
                fail('ALIGNMENT_AUDIO_LIMIT')
            audio = np.frombuffer(wav.readframes(count), dtype='<i2').astype(np.float32)
    except (wave.Error, EOFError):
        fail('ALIGNMENT_AUDIO_INCOMPATIBLE')
    audio = audio.reshape(-1, channels).mean(axis=1) / 32768
    if float(np.sqrt(np.mean(audio ** 2))) < .0001:
        fail('ALIGNMENT_SILENCE')
    divisor = math.gcd(rate, 16000)
    audio = resample_poly(audio, 16000 // divisor, rate // divisor).astype(np.float32)
    processor = Wav2Vec2Processor.from_pretrained(root, local_files_only=True)
    model = Wav2Vec2ForCTC.from_pretrained(root, local_files_only=True, weights_only=True).eval()
    tokens, words = script_tokens(request['input']['canonicalText'], processor.tokenizer.get_vocab(), request.get('textPolicy', 'strict/1'))
    device = 'cuda' if request['device'] == 'auto' and torch.cuda.is_available() else 'cpu'
    model.to(device)
    data = processor(audio, sampling_rate=16000, return_tensors='pt', padding=True)
    with torch.inference_mode():
        emissions = model(**{k: v.to(device) for k, v in data.items()}).logits[0].log_softmax(-1).cpu().numpy()
    blank = model.config.pad_token_id
    decoded, last = [], None
    for token in emissions.argmax(-1).tolist():
        if token != blank and token != last:
            decoded.append(token)
        last = token
    cer = check_transcript(tokens, decoded)
    spans = viterbi(emissions, tokens, blank)
    # True convolution stride, never duration/text proportions.
    stride = math.prod(model.config.conv_stride) / 16
    output = segments(request['input']['canonicalText'], words, spans, stride)
    if output[-1]['endMs'] > request['input']['durationMs']:
        fail('ALIGNMENT_DURATION_MISMATCH')
    import psutil
    memory = psutil.Process().memory_info()
    peak_memory = getattr(memory, 'peak_wset', memory.rss)
    if os.name != 'nt':
        import resource
        peak_memory = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == 'darwin' else 1024)
    return dict(segments=output, modelVersion=REVISION, algorithm=ALGORITHM,
                emissionsSha256=hashlib.sha256(emissions.astype('<f4').tobytes()).hexdigest(),
                device=device, cer=cer, peakMemoryBytes=peak_memory,
                latencyMs=round((time.monotonic() - started) * 1000))


if __name__ == '__main__':
    try:
        from limits import install
        install()
        request_path, model_path, manifest_hash = sys.argv[1:]
        path = Path(request_path)
        if path.stat().st_size > 65536:
            fail('ALIGNMENT_INPUT_LIMIT')
        result = run(json.loads(path.read_text('utf-8')), Path(model_path), manifest_hash)
        print(json.dumps(result, ensure_ascii=True, allow_nan=False))
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and str(error).startswith('ALIGNMENT_') else 'ALIGNMENT_PROCESS_FAILED'
        print(json.dumps({'error': code}))
        sys.exit(1)
