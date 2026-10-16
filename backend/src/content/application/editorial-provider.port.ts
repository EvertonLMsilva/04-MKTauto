import type { AffiliateBriefing } from '../../affiliate/domain/affiliate-contracts.js';
import type { ProjectSnapshot } from '../../project/application/ports/project-snapshot-reader.port.js';
import type {
  ResearchShortlist,
  ReferenceInsight,
} from '../../research/domain/research.types.js';
import type {
  EditorialScript,
  AffiliateEditorialSelection,
} from '../domain/content.types.js';

export const EDITORIAL_PROVIDER = Symbol('EDITORIAL_PROVIDER');
export interface EditorialProviderInput {
  briefing: AffiliateBriefing;
  shortlist: ResearchShortlist;
  references: ReferenceInsight | null;
  projectSnapshot: ProjectSnapshot;
}
export interface EditorialIdea {
  title: string;
  editorialAngle: string;
  evidenceCandidateIds: string[];
}
export type EditorialOutput = Pick<
  EditorialScript,
  | 'hook'
  | 'narrativeBlocks'
  | 'visualDirections'
  | 'cta'
  | 'estimatedDurationSeconds'
  | 'sensitiveClaims'
  | 'reviewFlags'
>;
// A LOCAL implementation must have no paid transport. Paid adapters require a
// separate trusted price/authorization integration; requests cannot select one.
export interface EditorialProvider {
  readonly mode: 'LOCAL' | 'PAID';
  readonly configurationVersion: string;
  ideas(input: Readonly<EditorialProviderInput>): Promise<EditorialIdea[]>;
  script(
    input: Readonly<
      EditorialProviderInput & { selection: AffiliateEditorialSelection }
    >,
  ): Promise<EditorialOutput>;
}
