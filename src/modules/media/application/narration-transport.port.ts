import type { TtsResult } from '../../finance/domain/tts-financial-contracts.js';

// Trusted transport returns media evidence only. Speech responses are not invoices.
export interface NarrationTransport {
  ready(): boolean;
  synthesize(request: any): Promise<Omit<TtsResult, 'billing'>>;
}
