import { join, dirname } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { ttsRiskFixture } from '../../test/support/tts-risk-fixture.js';
import { OpenAiNarrationTransport } from './infrastructure/openai-narration.transport.js';
import {
  ttsRequest,
  ttsHash,
} from '../finance/domain/tts-financial-contracts.js';
import { LocalEvidenceStorage } from './infrastructure/local-evidence-storage.js';
import { inspectMvpWav } from './infrastructure/physical-media-inspection.js';

describe('OpenAI speech transport with mocked HTTP only', () => {
  let f: ReturnType<typeof ttsRiskFixture>;
  beforeEach(() => {
    f = ttsRiskFixture();
  });
  afterEach(() => f?.close());
  const env = () => ({
    OPENAI_TTS_LIVE_ENABLED: 'true',
    OPENAI_API_KEY: 'fixture-not-a-key',
    FFMPEG_VOICE_ROOT: join(dirname(f.database), 'voice'),
    LOCAL_MEDIA_EVIDENCE_ROOT: join(dirname(f.database), 'evidence'),
  });
  it('wraps exact official PCM output as mono 24 kHz/16-bit WAV and persists provenance without a cost', async () => {
    const pcm = Buffer.alloc(24000 * 2);
    pcm.writeInt16LE(1024, 0);
    const send = vi.fn(
      async () =>
        new Response(pcm, {
          status: 200,
          headers: { 'x-request-id': 'req_fixture' },
        }),
    );
    const transport = new OpenAiNarrationTransport(env(), send as typeof fetch);
    const result = await transport.synthesize(ttsRequest(f.plan));
    expect(result.audio.durationMilliseconds).toBe(1000);
    expect('billing' in result).toBe(false);
    const bytes = new LocalEvidenceStorage(env().FFMPEG_VOICE_ROOT!).read(
      result.audio.contentHash,
      'wav',
    );
    expect(inspectMvpWav(bytes).durationMilliseconds).toBe(1000);
    expect(bytes.subarray(44)).toEqual(pcm);
    const [url, options] = send.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    if (typeof options.body !== 'string')
      throw new Error('Expected JSON speech body');
    expect(JSON.parse(options.body)).toMatchObject({
      model: 'gpt-4o-mini-tts',
      voice: 'marin',
      response_format: 'pcm',
      input: f.plan.operation.narration,
    });
    expect(send).toHaveBeenCalledTimes(1);
    const evidenceRoot = env().LOCAL_MEDIA_EVIDENCE_ROOT!;
    const documents = readdirSync(evidenceRoot, { recursive: true }).filter(
      (p) => String(p).endsWith('.json'),
    );
    expect(documents).toHaveLength(1);
    const provenance = JSON.parse(
      readFileSync(join(evidenceRoot, String(documents[0])), 'utf8'),
    );
    expect(provenance).toMatchObject({
      operationId: f.plan.operationId,
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      requestHash: ttsHash(ttsRequest(f.plan)),
      audioSha256: result.audio.contentHash,
      providerRequestId: 'req_fixture',
      script: f.plan.financialPolicy,
      billing: { status: 'UNAVAILABLE', actualCostUsd: null },
    });
  });
  it('keeps LIVE off by default and never retries an HTTP failure', async () => {
    const send = vi.fn(async () => new Response('uncertain', { status: 503 }));
    await expect(
      new OpenAiNarrationTransport(
        { ...env(), OPENAI_TTS_LIVE_ENABLED: 'false' },
        send as typeof fetch,
      ).synthesize(ttsRequest(f.plan)),
    ).rejects.toMatchObject({ code: 'TTS_LIVE_CONFIGURATION_REQUIRED' });
    expect(send).not.toHaveBeenCalled();
    await expect(
      new OpenAiNarrationTransport(env(), send as typeof fetch).synthesize(
        ttsRequest(f.plan),
      ),
    ).rejects.toMatchObject({ code: 'TTS_TRANSPORT_UNCERTAIN' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
