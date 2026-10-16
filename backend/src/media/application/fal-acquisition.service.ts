import { FalVideoAdapter } from './fal-video-provider.js';
import { validateMediaAcquisitionRequest } from '../domain/media-acquisition-contracts.js';
import { validateMediaAsset } from '../domain/media-asset-contracts.js';
import type {
  FalAcquisitionDependencies,
  PreparedFalRequest,
} from './fal-acquisition.port.js';
import { falFailure } from '../../finance/domain/fal-errors.js';
import { affiliateHash } from '../../affiliate/domain/affiliate-contracts.js';
import { stageIdentifier } from '../../content-operations/domain/stage-contracts.js';
import { requireGeneratedVideoScene } from '../domain/video-production-preparation.js';
import { validateFalVideoModel } from '../domain/fal-model.js';

export class FalAcquisitionService {
  constructor(
    private readonly dependencies: FalAcquisitionDependencies | null,
  ) {}
  async acquirePrepared(
    value: PreparedFalRequest,
    configuration: unknown,
    options: { signal?: AbortSignal } = {},
  ) {
    if (!this.dependencies) throw falFailure('FAL_LIVE_DISABLED');
    if (!this.dependencies.preparations)
      throw falFailure('VIDEO_PREPARATION_RESOLVER_REQUIRED');
    const input = structuredClone(value),
      config = structuredClone(configuration) as any;
    const scene = requireGeneratedVideoScene(
      input.preparation,
      input.scenePosition,
    );
    const request = validateMediaAcquisitionRequest(input.request);
    const model = validateFalVideoModel(config?.model);
    if (
      !config.budget ||
      typeof config.budget !== 'object' ||
      Array.isArray(config.budget)
    )
      throw falFailure('PROVIDER_INVALID_BUDGET');
    const authorization = input.authorization;
    if (
      !authorization ||
      authorization.authorized !== true ||
      authorization.preparationHash !== input.preparation.contentHash ||
      authorization.requestHash !== request.contentHash ||
      authorization.modelHash !== affiliateHash(model) ||
      authorization.budgetHash !== affiliateHash(config.budget) ||
      typeof authorization.statement !== 'string' ||
      !authorization.statement.trim() ||
      authorization.statement.length > 2000
    )
      throw falFailure('FAL_EXECUTION_AUTHORIZATION_REQUIRED');
    stageIdentifier(authorization.actorId, 'authorization.actorId', 200);
    if (
      request.assetType !== 'VIDEO' ||
      request.scriptId !== scene.acquisitionPlanned.scriptId ||
      request.scriptContentHash !==
        scene.acquisitionPlanned.scriptContentHash ||
      request.visualDirectionPosition !== scene.position ||
      scene.acquisitionPlanned.assetType !== 'VIDEO'
    )
      throw falFailure('PROVIDER_INPUT_MISMATCH');
    // Rebuild against current authoritative Content/Affiliate contracts, not caller-resealed data.
    const preparation = await this.dependencies.preparations.prepare({
      scriptId: input.preparation.script.scriptId,
      scriptContentHash: input.preparation.script.contentHash,
      scriptRevision: input.preparation.script.revision,
      expectedPreparationHash: input.preparation.contentHash,
      scenes: input.preparation.scenes.map((s) => ({
        visualDirectionPosition: s.position,
        sceneMediaType: s.sceneMediaType,
        movementRequirement: s.movementRequirement,
      })),
    });
    if (preparation.contentHash !== input.preparation.contentHash)
      throw falFailure('VIDEO_GENERATION_PREPARATION_CONFLICT');
    const mediaAsset = await this.perform(request, config, options, {
      preparation,
    });
    const job = this.dependencies.finance.getByAcquisitionRequest(
      request.mediaAcquisitionRequestId,
    );
    if (!job?.output || job.state !== 'COMPLETED')
      throw falFailure('PROVIDER_RECONCILIATION_PENDING');
    return {
      preparationId: preparation.preparationId,
      sceneId: scene.sceneId,
      jobState: job.state,
      providerRequestId: job.requestId,
      materialization: 'MATERIALIZED' as const,
      mediaAsset,
      motionValidation: 'NOT_VALIDATED' as const,
      compositionReady: false as const,
      financiallySettled: job.financiallySettled,
      observedCostAmount: job.observedCostAmount,
    };
  }
  async acquire(
    input: unknown,
    config: unknown,
    options: { signal?: AbortSignal } = {},
  ) {
    return this.perform(input, config, options);
  }
  private async perform(
    input: unknown,
    config: unknown,
    options: { signal?: AbortSignal },
    prepared?: { preparation: PreparedFalRequest['preparation'] },
  ) {
    if (!this.dependencies) throw falFailure('FAL_LIVE_DISABLED');
    const request = validateMediaAcquisitionRequest(input);
    const repository = this.dependencies.store.open();
    try {
      const script = repository.getScript(request.scriptId);
      if (!script || script.contentHash !== request.scriptContentHash)
        throw falFailure('PROVIDER_SCRIPT_MISMATCH');
      const run = repository.getRun(script.pipelineRunId);
      if (!run) throw falFailure('PROVIDER_RUN_NOT_ACTIVE');
      const prior = repository.getMediaAcquisition(
        request.mediaAcquisitionRequestId,
      );
      if (!prior && run.state !== 'RUNNING')
        throw falFailure('PROVIDER_RUN_NOT_ACTIVE');
      const direction = script.visualDirections.find(
        (d: { position: number }) =>
          d.position === request.visualDirectionPosition,
      );
      if (!direction) throw falFailure('PROVIDER_INPUT_MISMATCH');
      const adapter = new FalVideoAdapter(repository, config, {
        ...this.dependencies,
        jobs: this.dependencies.finance,
        prepared,
      });
      if (prior) {
        if (
          prior.requestHash !== request.contentHash ||
          prior.mediaAsset.pipelineRunId !== run.pipelineRunId ||
          prior.mediaAsset.projectId !== run.projectId ||
          prior.mediaAsset.projectVersion !== run.projectVersion ||
          prior.mediaAsset.scriptId !== request.scriptId ||
          prior.mediaAsset.scriptContentHash !== request.scriptContentHash ||
          prior.mediaAsset.visualDirectionPosition !==
            request.visualDirectionPosition ||
          prior.mediaAsset.assetType !== request.assetType
        )
          throw falFailure('PROVIDER_REQUEST_CONFLICT');
        await adapter.validateReuse(prior.mediaAsset, request, options);
        return prior.mediaAsset;
      }
      const output = await adapter.provide(
        {
          assetType: request.assetType,
          logicalCallId: request.mediaAcquisitionRequestId,
          visualDirection: direction,
        },
        { ...options, acquisitionRequest: request },
      );
      const reusable = adapter.findReusableAsset(request, output);
      if (reusable) return reusable;
      const mediaAsset = validateMediaAsset({
        schemaVersion: 'media-asset/2.0.0',
        mediaAssetId: `media_asset:${request.mediaAcquisitionRequestId}`,
        pipelineRunId: run.pipelineRunId,
        projectId: run.projectId,
        projectVersion: run.projectVersion,
        scriptId: script.scriptId,
        scriptContentHash: script.contentHash,
        visualDirectionPosition: request.visualDirectionPosition,
        assetType: output.assetType,
        technicalProperties: output.technicalProperties,
        contentHash: output.contentHash,
        mediaReference: output.mediaReference,
        origin: output.origin,
        provider: output.provider,
        rights: output.rights,
        source: output.source,
        createdAt: request.requestedAt,
        revision: 1,
        supersedesMediaAssetId: null,
      });
      return repository.registerAcquiredMediaAsset({ request, mediaAsset });
    } finally {
      repository.close();
    }
  }
}
