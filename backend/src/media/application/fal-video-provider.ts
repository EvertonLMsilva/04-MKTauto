import {
  validateMediaAcquisitionRequest,
  validateMediaProviderOutput,
} from '../domain/media-acquisition-contracts.js';
import { falFailure } from '../../finance/domain/fal-errors.js';

import {
  FAL_VIDEO_ENDPOINT,
  FAL_VIDEO_MODEL,
  validateFalVideoModel,
} from '../domain/fal-model.js';
import { assertMediaProcessingRights } from '../domain/media-processing-rights.js';
export class FalVideoAdapter {
  repository: any;
  config: any;
  resolveImage: any;
  jobs: any;
  affiliate: any;
  queue: any;
  storage: any;
  prepared: any;
  constructor(
    repository: any,
    config: any,
    { queue, storage, resolveImage, jobs, briefings, prepared }: any = {},
  ) {
    if (
      config?.rights?.usageBasis !== 'PROVIDER_TERMS' ||
      config.rights.commercialUseAllowed !== true ||
      Object.keys(config.rights).some(
        (key: any) => !['usageBasis', 'commercialUseAllowed'].includes(key),
      )
    )
      throw falFailure('PROVIDER_RIGHTS_REQUIRED');
    if (typeof resolveImage !== 'function')
      throw falFailure('PROVIDER_IMAGE_RESOLVER_REQUIRED');
    this.repository = repository;
    this.config = structuredClone(config);
    this.resolveImage = resolveImage;
    this.jobs = jobs;
    this.affiliate = briefings;
    this.queue = queue;
    if (!queue || !storage || !jobs || !briefings)
      throw falFailure('PROVIDER_CONFIGURATION_INVALID');
    this.storage = storage;
    this.prepared = prepared && structuredClone(prepared);
  }
  getGenerationState(acquisitionRequestId: any) {
    return this.jobs.getByAcquisitionRequest(acquisitionRequestId);
  }
  async validateReuse(asset: any, request: any, { signal }: any = {}) {
    const alias = this.jobs.getRequestBinding(
      request.mediaAcquisitionRequestId,
    );
    const job = alias && this.jobs.get(alias.generation_key);
    const briefing = this.affiliate.resolveRunBriefing(asset.pipelineRunId);
    const current = this.prepared
      ? await this.resolveAuthorizedImage(
          this.repository.getScript(asset.scriptId),
          signal,
        )
      : null;
    if (
      !job?.output ||
      alias.request_hash !== request.contentHash ||
      job.output.contentHash !== asset.contentHash ||
      job.basis.briefingHash !== briefing?.contentHash ||
      job.basis.mediaRef !== this.config.mediaRef ||
      (this.prepared &&
        (job.basis.preparation?.contentHash !==
          this.prepared.preparation.contentHash ||
          job.basis.imageHash !== current?.image.contentHash))
    )
      throw falFailure('PROVIDER_REQUEST_CONFLICT');
    if (!(await this.storage.verify(job.output, { signal })))
      throw falFailure('PROVIDER_ARTIFACT_UNAVAILABLE');
  }
  private async resolveAuthorizedImage(script: any, signal?: AbortSignal) {
    const briefing = this.affiliate.resolveRunBriefing(script.pipelineRunId);
    if (!briefing || !briefing.mediaRefs.includes(this.config.mediaRef))
      throw falFailure('PROVIDER_IMAGE_NOT_AUTHORIZED');
    if (
      this.prepared &&
      (this.prepared.preparation.script.contentHash !== script.contentHash ||
        this.prepared.preparation.script.revision !== script.revision ||
        this.prepared.preparation.commercial.briefingHash !==
          briefing.contentHash ||
        !this.prepared.preparation.commercial.authorizedMediaRefs.includes(
          this.config.mediaRef,
        ))
    )
      throw falFailure('PROVIDER_PREPARATION_CONFLICT');
    if (signal?.aborted) throw falFailure('PROVIDER_CANCELLED');
    const image = await this.resolveImage(this.config.mediaRef, { signal });
    let url;
    try {
      url = new URL(image?.url);
    } catch {
      throw falFailure('PROVIDER_IMAGE_INVALID');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      typeof image.contentHash !== 'string' ||
      image.contentHash.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(image.contentHash)
    )
      throw falFailure('PROVIDER_IMAGE_INVALID');
    assertMediaProcessingRights(
      briefing.evidence,
      { mediaRef: this.config.mediaRef, contentHash: image.contentHash },
      'fal_ai',
    );
    if (
      this.prepared &&
      !briefing.evidence.some(
        (e: any) =>
          e.kind === 'MEDIA_USAGE_RIGHT' &&
          e.id === image.provenance?.evidenceRef &&
          e.sourceRef === image.provenance?.sourceRef &&
          e.mediaAuthorization?.mediaRef === this.config.mediaRef &&
          e.mediaAuthorization?.contentHash === image.contentHash,
      )
    )
      throw falFailure('PROVIDER_IMAGE_PROVENANCE_REQUIRED');
    return { briefing, image, url };
  }
  findReusableAsset(request: any, output: any) {
    return (
      this.repository
        .listMediaAssetsByVisualDirection(
          request.scriptId,
          request.visualDirectionPosition,
        )
        .find(
          (asset: any) =>
            asset.assetType === 'VIDEO' &&
            asset.provider === 'fal_ai' &&
            asset.scriptContentHash === request.scriptContentHash &&
            asset.contentHash === output.contentHash &&
            asset.mediaReference === output.mediaReference,
        ) ?? null
    );
  }
  async provide(input: any, { signal, acquisitionRequest }: any = {}) {
    const request = validateMediaAcquisitionRequest(acquisitionRequest);
    if (request.assetType !== 'VIDEO' || input.assetType !== 'VIDEO')
      throw falFailure('PROVIDER_UNSUPPORTED_ASSET_TYPE');
    const script = this.repository.getScript(request.scriptId);
    if (!script || script.contentHash !== request.scriptContentHash)
      throw falFailure('PROVIDER_SCRIPT_MISMATCH');
    const direction = script.visualDirections.find(
      (item: any) => item.position === request.visualDirectionPosition,
    );
    if (
      !direction ||
      input.logicalCallId !== request.mediaAcquisitionRequestId ||
      input.visualDirection.description !== direction.description
    )
      throw falFailure('PROVIDER_INPUT_MISMATCH');
    const { briefing, image, url } = await this.resolveAuthorizedImage(
      script,
      signal,
    );
    const { endpoint: _endpoint, ...technical } = this.prepared
      ? validateFalVideoModel(this.config.model)
      : FAL_VIDEO_MODEL;
    const parameters = {
      prompt: direction.description,
      image_url: url.href,
      ...technical,
    };
    // URL is transport only; stable image identity is the authorized reference plus physical hash.
    const basis = {
      pipelineRunId: script.pipelineRunId,
      scriptId: script.scriptId,
      scriptContentHash: script.contentHash,
      visualDirectionPosition: direction.position,
      briefingHash: briefing.contentHash,
      mediaRef: this.config.mediaRef,
      imageHash: image.contentHash,
      endpoint: FAL_VIDEO_ENDPOINT,
      parameters: { ...parameters, image_url: this.config.mediaRef },
      rights: this.config.rights,
      // Request-specific consent is checked at entry. Keep content deduplication across request aliases.
      ...(this.prepared ? { preparation: this.prepared.preparation } : {}),
    };
    let job = this.jobs.reserve({
      basis,
      request,
      budget: this.config.budget,
      estimate: this.config.estimate,
    });
    if (job.output) {
      if (!(await this.storage.verify(job.output, { signal })))
        throw falFailure('PROVIDER_ARTIFACT_UNAVAILABLE');
      return job.output;
    }
    if (job.owner) {
      try {
        const submitted = await this.queue.submit(parameters, { signal });
        job = this.jobs.submitted(job.key, submitted.requestId, submitted);
        if (submitted.reconciliationPending)
          throw falFailure('PROVIDER_RECONCILIATION_PENDING');
      } catch {
        this.jobs.uncertain(job.key);
        throw falFailure('PROVIDER_RECONCILIATION_PENDING');
      }
    }
    if (!job.requestId) throw falFailure('PROVIDER_RECONCILIATION_PENDING');
    if (job.state === 'FAILED') throw falFailure('PROVIDER_GENERATION_FAILED');
    if (job.state !== 'COMPLETED') {
      let status;
      try {
        status = await this.queue.status(job.requestId, {
          signal,
          url: job.statusUrl,
        });
      } catch {
        throw falFailure('PROVIDER_STATUS_UNAVAILABLE');
      }
      if (status.error !== undefined && status.error !== null)
        job = this.jobs.state(job.key, 'FAILED');
      else job = this.jobs.state(job.key, status.status);
      if (job.state === 'FAILED')
        throw falFailure('PROVIDER_GENERATION_FAILED');
      if (job.state !== 'COMPLETED')
        throw falFailure('PROVIDER_GENERATION_PENDING');
    }
    // GET/download/storage may be repeated safely. Never submit again, including invalid results.
    let result;
    try {
      result = await this.queue.result(job.requestId, {
        signal,
        url: job.responseUrl,
      });
    } catch {
      throw falFailure('PROVIDER_RESULT_UNAVAILABLE');
    }
    const bytes = await this.queue.download(result.video?.url, { signal });
    const stored = await this.storage.store(bytes, { signal });
    const output = validateMediaProviderOutput(
      {
        assetType: 'VIDEO',
        technicalProperties: {
          format: stored.format,
          mimeType: stored.mimeType,
          widthPixels: stored.widthPixels,
          heightPixels: stored.heightPixels,
          durationMilliseconds: stored.durationMilliseconds,
          hasAudio: stored.hasAudio,
        },
        contentHash: stored.contentHash,
        mediaReference: stored.mediaReference,
        origin: 'PROVIDER_GENERATED',
        provider: 'fal_ai',
        rights: this.config.rights,
        source: null,
      },
      { physicalWrite: true },
    );
    return this.jobs.complete(job.key, output);
  }
}
