import type {
  EditorialProvider,
  EditorialProviderInput,
  EditorialOutput,
} from '../application/editorial-provider.port.js';
import type { AffiliateEditorialSelection } from '../domain/content.types.js';

export class FakeEditorialProvider implements EditorialProvider {
  mode: 'LOCAL' | 'PAID' = 'LOCAL';
  readonly configurationVersion = 'fake-editorial/1.0.0';
  async ideas(input: EditorialProviderInput) {
    return [
      {
        title: `Conheça ${input.briefing.productName}`,
        editorialAngle: 'Características documentadas para o cotidiano',
        evidenceCandidateIds: [
          input.shortlist.orderedCandidates[0].candidate.id,
        ],
      },
    ];
  }
  async script(
    input: EditorialProviderInput & { selection: AffiliateEditorialSelection },
  ): Promise<EditorialOutput> {
    const b = input.briefing;
    return {
      hook: `Conheça ${b.productName}.`,
      narrativeBlocks: [
        {
          position: 1,
          purpose: 'EXPLANATION',
          narration: `${b.disclosure}. ${b.attributes.map((a) => `${a.name}: ${a.value}`).join('. ')}.`,
        },
      ],
      visualDirections: [
        {
          position: 1,
          blockPosition: 1,
          description: `Usar somente imagens autorizadas de ${b.productName}.`,
        },
      ],
      cta: b.cta,
      estimatedDurationSeconds:
        input.projectSnapshot.channel.minDurationSeconds,
      sensitiveClaims: [],
      reviewFlags: ['HUMAN_REVIEW_REQUIRED'],
    };
  }
}
export class UnavailableEditorialProvider implements EditorialProvider {
  readonly mode = 'LOCAL';
  readonly configurationVersion = 'unavailable/1.0.0';
  async ideas(): Promise<never> {
    throw new Error('EDITORIAL_PROVIDER_UNAVAILABLE');
  }
  async script(): Promise<never> {
    throw new Error('EDITORIAL_PROVIDER_UNAVAILABLE');
  }
}
