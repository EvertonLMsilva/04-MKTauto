import { FalVideoAdapter } from './fal-video-provider.js';
import { validateMediaAcquisitionRequest } from '../domain/media-acquisition-contracts.js';
import { validateMediaAsset } from '../domain/media-asset-contracts.js';
import type { FalAcquisitionDependencies } from './fal-acquisition.port.js';
import { falFailure } from '../../finance/domain/fal-errors.js';

export class FalAcquisitionService {
  constructor(
    private readonly dependencies: FalAcquisitionDependencies | null,
  ) {}
  async acquire(
    input: unknown,
    config: unknown,
    options: { signal?: AbortSignal } = {},
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
