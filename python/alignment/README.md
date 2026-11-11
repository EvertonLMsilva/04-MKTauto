# Local CTC alignment (P3C)

Requires a dedicated Python 3.12 venv **outside the checkout**. No global packages,
CUDA/driver changes, remote code or paid services are needed.

Install `requirements.lock` with that venv's `python -m pip install -r ...`.
Run `python -B prepare.py <absolute-external-model-directory>` once to download
only approved model files at revision `634ac655299bcdc46c83bc01da9bab52d2987e4f`.
Model: jonatasgrosman/wav2vec2-large-xlsr-53-portuguese, Apache-2.0
([model card](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-portuguese)).
The preparation command writes file SHA-256 values in `manifest.json`, plus
installed package versions, licenses and metadata/RECORD hashes in `environment.json`.
These files and model weights stay outside Git. Pin the printed manifest SHA-256
in trusted deployment configuration, independently of the model directory.

Nest configuration:

- `LOCAL_ALIGNMENT_PYTHON`: absolute venv Python executable.
- `LOCAL_ALIGNMENT_MODEL_ROOT`: absolute prepared model directory.
- `LOCAL_ALIGNMENT_MODEL_SHA256`: printed manifest SHA-256.
- `LOCAL_ALIGNMENT_EVIDENCE_KEY`: deployment secret, at least 32 characters;
  retain it to verify existing evidence, never send it to clients or Python.
- `LOCAL_ALIGNMENT_DEVICE`: `cpu` (default), or `auto` to use an already available
  CUDA GPU with CPU fallback. No driver installation is performed.
- Existing P3-B evidence, voice/render roots and explicit test/deployment DB apply.

Ingest authorized WAV audio through P3-B first, then call
`POST /media/local/audio/:id/align`, where `id` is the persisted voice-track ID.
No client paths or replacement script text are accepted. Existing alignment,
subtitles, composition, QC and preview endpoints remain authoritative.

Limits: PCM16 WAV, 1–2 channels, 8–96 kHz converted to mono 16 kHz, at most
20 MiB/60 seconds/6000 UTF-16 text units, 20 million Viterbi cells,
180-second worker timeout, 1 MiB combined worker output, 6 GiB process/job memory.
Windows Job Objects also terminate descendants; Unix address-space limits apply.
Inference is offline (`local_files_only`, offline environment, `weights_only=True`).
The greedy acoustic transcript must have token CER <= 0.25; forced-path mean
token probability must be >= 0.05. These are conservative rejection gates,
not calibrated timing accuracy guarantees. Unsupported text, silence and
incomplete paths fail explicitly. Original text, accents, punctuation and UTF-16
offsets remain in evidence; timing comes from acoustic frames/convolution stride.

Evidence includes model manifest, emissions digest, configuration identity, CER,
latency and memory, sealed with an HMAC independent of the public document hash.
The immutable first successful result is replayed. Atomic external lock directories
serialize workers; a crashed worker leaves a stale lock and subsequent attempts
fail with `ALIGNMENT_BUSY_CONFLICT`. An operator may remove that one lock only
after verifying no associated worker is alive. No automatic stale-lock takeover.

Operational acceptance requires an explicitly authorized pt-BR WAV and matching
script. Synthetic emissions/fixture Media tests do **not** complete P3. Report
timing errors only against a human reference, and p95 only with sufficient samples.
Local electricity/hardware cost is unavailable unless measured; no paid API cost
is incurred by this adapter.
