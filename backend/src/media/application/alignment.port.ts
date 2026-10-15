import type {
  AlignmentEvidence,
  AlignmentInput,
} from '../domain/alignment-contracts.js';
export interface AudioAligner {
  align(input: AlignmentInput, actualAudio: Buffer): Promise<AlignmentEvidence>;
}
// Provenance verification is separate from the self-declared status and digest.
export interface AlignmentProvenanceVerifier {
  verify(evidence: AlignmentEvidence, actualAudio: Buffer): Promise<boolean>;
}
export class PinnedAlignmentVerifier implements AlignmentProvenanceVerifier {
  constructor(private readonly trustedEvidenceHashes: ReadonlySet<string>) {}
  verify(evidence: AlignmentEvidence, _audio: Buffer): Promise<boolean> {
    return Promise.resolve(
      this.trustedEvidenceHashes.has(evidence.output.evidenceHash),
    );
  }
}
