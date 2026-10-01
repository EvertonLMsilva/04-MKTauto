import { MEDIA_ACQUISITION_REQUEST_VERSION, mediaAcquisitionRequestHash } from "./domain/media-acquisition-contracts.js";
import { validateMediaSelectionRequest } from "./domain/media-selection-contracts.js";

export class MediaSelectionService {
  constructor(repository, { video, image }) {
    if (!repository || typeof repository.getMediaSelection !== "function" || typeof repository.registerMediaSelection !== "function") throw new TypeError("repositório de seleção obrigatório");
    if (!video || typeof video.acquire !== "function" || !image || typeof image.acquire !== "function") throw new TypeError("serviços de aquisição obrigatórios");
    this.repository = repository; this.video = video; this.image = image;
  }

  async select(value, { signal } = {}) {
    const request = validateMediaSelectionRequest(value);
    const prior = this.repository.getMediaSelection(request.mediaSelectionRequestId);
    if (prior) {
      if (prior.requestHash !== request.contentHash) throw failure("MEDIA_SELECTION_REQUEST_ID_REUSED", "mediaSelectionRequestId");
      return prior.mediaAsset;
    }
    const script = this.repository.getScript(request.scriptId); if (!script) throw failure("SCRIPT_NOT_FOUND", "scriptId");
    const run = this.repository.getRun(script.pipelineRunId); if (!run) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId");
    if (script.contentHash !== request.scriptContentHash) throw failure("SCRIPT_CONTENT_HASH_MISMATCH", "scriptContentHash");
    if (run.projectSnapshot.channel.productionProfile !== request.productionProfile) throw failure("PRODUCTION_PROFILE_MISMATCH", "productionProfile");
    let asset; let fallbackCode = null;
    if (request.productionProfile === "MIXED_MEDIA_V2") {
      try { asset = await this.video.acquire(acquisition(request, "VIDEO"), { signal }); }
      catch (caught) {
        if (caught?.code !== "PROVIDER_NO_ELIGIBLE_VIDEO") throw caught;
        fallbackCode = "PROVIDER_NO_ELIGIBLE_VIDEO";
      }
    }
    asset ??= await this.image.acquire(acquisition(request, "IMAGE"), { signal });
    return this.repository.registerMediaSelection({ request, mediaAsset: asset, fallbackCode });
  }
}

function acquisition(request, assetType) {
  const base = { schemaVersion: MEDIA_ACQUISITION_REQUEST_VERSION, mediaAcquisitionRequestId: `${request.mediaSelectionRequestId}:${assetType.toLowerCase()}`, scriptId: request.scriptId, scriptContentHash: request.scriptContentHash, visualDirectionPosition: request.visualDirectionPosition, assetType, requestedAt: request.requestedAt, contentHash: "" };
  return Object.freeze({ ...base, contentHash: mediaAcquisitionRequestHash(base) });
}
function failure(code, field) { return Object.assign(new Error(`${code}: operação inválida`), { code, field }); }
