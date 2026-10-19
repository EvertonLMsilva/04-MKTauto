import { isAbsolute } from 'node:path';
import {
  isTtsRiskRequest,
  ttsFail,
  ttsHash,
} from '../../finance/domain/tts-financial-contracts.js';
import type { NarrationTransport } from '../application/narration-transport.port.js';
import {
  LocalEvidenceStorage,
  digest,
  documentBytes,
} from './local-evidence-storage.js';
import { inspectMvpWav } from './physical-media-inspection.js';

// One transport for NarrationService, fixed official endpoint, no retries or fallback.
export class OpenAiNarrationTransport implements NarrationTransport {
  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly send: typeof fetch = fetch,
  ) {}
  ready() {
    return (
      this.env.OPENAI_TTS_LIVE_ENABLED === 'true' &&
      !!this.env.OPENAI_API_KEY &&
      !!this.env.FFMPEG_VOICE_ROOT &&
      isAbsolute(this.env.FFMPEG_VOICE_ROOT) &&
      !!this.env.LOCAL_MEDIA_EVIDENCE_ROOT &&
      isAbsolute(this.env.LOCAL_MEDIA_EVIDENCE_ROOT)
    );
  }
  async synthesize(request: any) {
    if (!this.ready()) ttsFail('TTS_LIVE_CONFIGURATION_REQUIRED');
    if (
      !isTtsRiskRequest(request) ||
      request.model !== 'gpt-4o-mini-tts' ||
      request.voice !== 'marin'
    )
      ttsFail('TTS_INVALID_PLAN');
    const audioFiles = new LocalEvidenceStorage(this.env.FFMPEG_VOICE_ROOT!);
    const evidenceFiles = new LocalEvidenceStorage(
      this.env.LOCAL_MEDIA_EVIDENCE_ROOT!,
    );
    const abort = new AbortController();
    const response = await this.send('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
      },
      signal: AbortSignal.any([AbortSignal.timeout(30000), abort.signal]),
      body: JSON.stringify({
        model: request.model,
        voice: request.voice,
        input: request.operation.narration,
        instructions:
          'Fale em português brasileiro, com tom informativo e natural.',
        response_format: 'pcm',
      }),
    });
    if (!response.ok || !response.body) ttsFail('TTS_TRANSPORT_UNCERTAIN');
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 20971520) {
          abort.abort();
          ttsFail('TTS_AUDIO_INVALID');
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    if (!size || size % 2) ttsFail('TTS_AUDIO_INVALID');
    // Official PCM output: mono 24 kHz, signed little-endian 16-bit samples.
    const header = Buffer.alloc(44);
    header.write('RIFF');
    header.writeUInt32LE(size + 36, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(24000, 24);
    header.writeUInt32LE(48000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(size, 40);
    const bytes = Buffer.concat([header, ...chunks]);
    const facts = inspectMvpWav(bytes);
    const hash = audioFiles.put(bytes, 'wav');
    const providerRequestId = response.headers.get('x-request-id');
    evidenceFiles.put(
      documentBytes({
        schemaVersion: 'openai-tts-provenance/2.0.0',
        operationId: request.operationId,
        requestHash: ttsHash(request),
        provider: 'openai',
        model: request.model,
        voice: request.voice,
        script: request.financialPolicy,
        narrationHash: request.narrationHash,
        providerRequestId,
        pcmSha256: digest(Buffer.concat(chunks)),
        audioSha256: hash,
        format: {
          codec: 'pcm_s16le',
          sampleRate: 24000,
          channels: 1,
          sampleWidth: 2,
        },
        rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
        synthetic: true,
        billing: { status: 'UNAVAILABLE', actualCostUsd: null },
      }),
      'json',
    );
    return {
      audio: {
        durationMilliseconds: facts.durationMilliseconds,
        audioFormat: 'wav',
        contentHash: hash,
        storageReference: `object:voice/sha256/${hash}`,
        provider: 'openai',
        origin: 'SYNTHETIC_TTS',
        rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
      },
      providerRequestId,
    };
  }
}
