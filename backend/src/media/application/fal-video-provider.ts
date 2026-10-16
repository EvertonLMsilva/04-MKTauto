import {
  validateMediaAcquisitionRequest,
  validateMediaProviderOutput,
} from '../domain/media-acquisition-contracts.js';
import { falFailure } from '../../finance/domain/fal-errors.js';

import { FAL_VIDEO_ENDPOINT } from '../domain/fal-model.js';
export class FalVideoAdapter {
  repository: any;
  config: any;
  resolveImage: any;
  jobs: any;
  affiliate: any;
  queue: any;
  storage: any;
  constructor(
    repository: any,
    config: any,
    { queue, storage, resolveImage, jobs, briefings }: any = {},
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
    if (
      !job?.output ||
      alias.request_hash !== request.contentHash ||
      job.output.contentHash !== asset.contentHash ||
      job.basis.briefingHash !== briefing?.contentHash ||
      job.basis.mediaRef !== this.config.mediaRef
    )
      throw falFailure('PROVIDER_REQUEST_CONFLICT');
    if (!(await this.storage.verify(job.output, { signal })))
      throw falFailure('PROVIDER_ARTIFACT_UNAVAILABLE');
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
    const briefing = this.affiliate.resolveRunBriefing(script.pipelineRunId);
    if (!briefing || !briefing.mediaRefs.includes(this.config.mediaRef))
      throw falFailure('PROVIDER_IMAGE_NOT_AUTHORIZED');
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
      !/^[a-f0-9]{64}$/.test(image.contentHash)
    )
      throw falFailure('PROVIDER_IMAGE_INVALID');
    const parameters = {
      prompt: direction.description,
      image_url: url.href,
      duration: 5,
      resolution: '768P',
      prompt_expansion_mode: 'disabled',
      enable_safety_checker: true,
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
    const output = validateMediaProviderOutput({
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
    });
    return this.jobs.complete(job.key, output);
  }
}
