import { validateDiscoveryMedia } from './discovery-media-evidence.js';
import { readFileSync } from 'node:fs';
import {
  discoveryCandidate,
  discoveryAt,
} from '../../../test/support/discovery-fixture.js';
import { historicalContracts } from '../../../test/support/historical-contracts.js';
const legacy = historicalContracts('discovery-media-evidence');
const outcome = (fn: () => unknown) => {
  try {
    return fn();
  } catch (e) {
    return {
      code: (e as { code?: string }).code,
      path: (e as { path?: string }).path,
    };
  }
};
describe('embedded discovery media evidence JS × TS', () => {
  it('uses independent historical observations instead of a legacy runtime', () => {
    expect(
      readFileSync(
        new URL('./discovery-media-evidence.spec.ts', import.meta.url),
        'utf8',
      ),
    ).not.toMatch(/new URL\(\s*['"]\.\.\/\.\.\/\.\.\/\.\.\/src\/[^'"]+\.js/);
  });
  it('matches validation of rights, provenance and optional normalized telemetry', () => {
    const m = discoveryCandidate().mediaRightsEvidence.materials[0];
    const telemetry = {
      provider: 'fixture',
      model: 'fixture',
      taskType: 'image',
      promptVersion: 'fixture/1.0.0',
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      usageOrigin: null,
      costAmount: null,
      currency: null,
      costOrigin: null,
      latencyMs: null,
      occurredAt: discoveryAt,
      fallback: null,
      inputHash: null,
      outputHash: null,
    };
    const withTelemetry = { ...m, telemetry };
    const inputs = [
      m,
      withTelemetry,
      {
        ...withTelemetry,
        telemetry: {
          ...telemetry,
          costAmount: '0001.2000',
          currency: 'BRL',
          costOrigin: 'fixture',
        },
      },
      { ...withTelemetry, telemetry: { ...telemetry, costAmount: '0' } },
      { ...withTelemetry, telemetry: { ...telemetry, inputTokens: 2 } },
      {
        ...withTelemetry,
        telemetry: {
          ...telemetry,
          inputTokens: 2,
          cachedInputTokens: 3,
          usageOrigin: 'fixture',
        },
      },
      {
        ...withTelemetry,
        telemetry: { ...telemetry, promptVersion: 'invalid' },
      },
      { ...m, rights: { usageBasis: 'OWNED', commercialUseAllowed: false } },
      { ...m, mediaReference: 'https://example.com/private' },
      { ...m, origin: 'OPERATOR_LICENSED' },
      { ...m, provider: 'fixture' },
      {
        ...m,
        source: {},
        technicalProperties: {
          ...m.technicalProperties,
          mimeType: 'image/png',
          hasAudio: null,
        },
      },
      {
        ...m,
        technicalProperties: { ...m.technicalProperties, widthPixels: 0 },
      },
      { ...m, contentHash: 'invalid' },
    ];
    for (const v of inputs)
      expect(outcome(() => validateDiscoveryMedia(v))).toEqual(
        outcome(() => legacy.validateMediaProviderOutput(v)),
      );
  });
});
