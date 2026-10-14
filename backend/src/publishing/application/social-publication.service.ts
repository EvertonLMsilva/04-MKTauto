import { requireSocialPublisherPort } from '../application/ports/social-publisher-port.js';
import {
  socialFail,
  accountId,
  validateSocialPrepare,
  instagramCaption,
  validateTransfer,
} from '../domain/social-publication-contracts.js';
export class SocialPublicationService {
  [key: string]: any;
  #allowLivePosts;
  constructor({
    repository,
    manual,
    publisher,
    media,
    transferVerifier,
    allowLivePosts = false,
    now = (): any => new Date().toISOString(),
  }: any) {
    requireSocialPublisherPort(publisher);
    if (
      !repository?.transition ||
      !manual?.validateForPublication ||
      typeof media?.inspect !== 'function'
    )
      throw new TypeError('social ports required');
    const mode: any = publisher.mode ?? 'fake';
    if (
      repository.mode !== mode ||
      (transferVerifier && transferVerifier.mode !== mode)
    )
      socialFail('SOCIAL_EXECUTION_MODE_MISMATCH');
    if (manual.repository?.db !== repository.db)
      socialFail('SOCIAL_DATABASE_BOUNDARY_INVALID');
    if (typeof allowLivePosts !== 'boolean')
      socialFail('SOCIAL_CONFIG_INVALID');
    this.#allowLivePosts = allowLivePosts;
    Object.assign(this, {
      repository,
      manual,
      publisher,
      media,
      transferVerifier,
      now,
    });
  }
  #boundary(): any {
    const mode: any = this.publisher.mode ?? 'fake';
    if (
      this.repository.mode !== mode ||
      (this.transferVerifier && this.transferVerifier.mode !== mode)
    )
      socialFail('SOCIAL_EXECUTION_MODE_MISMATCH');
    if (this.manual.repository?.db !== this.repository.db)
      socialFail('SOCIAL_DATABASE_BOUNDARY_INVALID');
  }
  #get(id: any): any {
    this.#boundary();
    const value: any = this.repository.get(id);
    if (!value) socialFail('SOCIAL_OPERATION_NOT_FOUND');
    if (value.uploadStrategy) socialFail('SOCIAL_EXECUTION_STRATEGY_MISMATCH');
    return value;
  }
  #mutationAllowed(): any {
    if (this.publisher.mode === 'live' && !this.#allowLivePosts)
      socialFail('SOCIAL_LIVE_POST_BLOCKED');
    this.publisher.assertMutationAllowed?.();
  }
  async #gate(packageHash: any, account: any): Promise<any> {
    const p: any = this.manual.validateForPublication(packageHash);
    if (
      p.platform !== 'instagram' ||
      p.account !== account ||
      this.publisher.accountId !== account
    )
      socialFail('SOCIAL_DESTINATION_INVALID');
    if (this.manual.listPublications(packageHash).length)
      socialFail('SOCIAL_ALREADY_MANUALLY_RECORDED');
    const profile: any = await this.media.inspect(p.mediaReference);
    if (
      profile.contentHash !== p.identity.videoRenderContentHash ||
      profile.result !== 'PASS' ||
      profile.policyVersion !== 'instagram-reels-profile/1.0.0'
    )
      socialFail('SOCIAL_MEDIA_INCOMPATIBLE');
    this.manual.validateForPublication(packageHash); // Rights/bytes may change while probing.
    return { p, caption: instagramCaption(p) };
  }
  async prepare(raw: any, key: any): Promise<any> {
    this.#boundary();
    const v: any = validateSocialPrepare(raw),
      { p, caption } = await this.#gate(v.packageHash, v.accountId);
    return this.repository.prepare(
      { ...v, mediaHash: p.identity.videoRenderContentHash, caption },
      key,
      this.now(),
    );
  }
  #transition(op: any, allowed: any, patch: any): any {
    return this.repository.transition(
      op.operationId,
      op.version,
      allowed,
      patch,
      this.now(),
    );
  }
  async #post(
    op: any,
    intent: any,
    stage: any,
    action: any,
    result: any,
    extra: any = {},
  ): Promise<any> {
    this.#mutationAllowed();
    const claim: any = this.#transition(op, [op.state], {
      state: intent,
      errorCode: null,
      ...extra,
    });
    if (!claim.claimed) return claim.value;
    let patch: any;
    try {
      const receipt: any = await action();
      accountId(stage === 'CREATE' ? receipt?.containerId : receipt?.mediaId);
      patch = result(receipt);
    } catch {
      return this.#transition(claim.value, [intent], {
        state: 'UNCERTAIN',
        uncertainStage: stage,
        errorCode: 'SOCIAL_POST_UNCONFIRMED',
      }).value;
    }
    // Database failures propagate. The persisted intent remains recoverable;
    // never disguise a failed receipt commit as an HTTP failure or resend.
    return this.#transition(claim.value, [intent], patch).value;
  }
  async createContainer(id: any, transfer: any): Promise<any> {
    const op: any = this.#get(id);
    if (op.state !== 'PREPARED') return op;
    const { caption } = await this.#gate(op.packageHash, op.accountId);
    validateTransfer(transfer, op.mediaHash, this.now());
    this.#mutationAllowed();
    if (!this.transferVerifier?.verifyTransfer)
      socialFail('SOCIAL_HOSTED_MEDIA_UNVERIFIED');
    const transferEvidence: any =
      await this.transferVerifier.verifyTransfer(transfer);
    this.manual.validateForPublication(op.packageHash);
    return this.#post(
      op,
      'CREATING_CONTAINER',
      'CREATE',
      (): any =>
        this.publisher.createContainer({
          accountId: op.accountId,
          caption,
          videoUrl: transfer.url,
        }),
      (receipt: any): any => ({
        state: 'PROCESSING',
        containerId: receipt.containerId,
        uncertainStage: null,
      }),
      { transferEvidence },
    );
  }
  async process(id: any): Promise<any> {
    const op: any = this.#get(id);
    if (op.state !== 'PROCESSING') return op;
    return this.#status(op, false);
  }
  async publish(id: any): Promise<any> {
    const op: any = this.#get(id);
    if (op.state !== 'READY') return op;
    await this.#gate(op.packageHash, op.accountId);
    this.#mutationAllowed();
    if (!this.transferVerifier?.verifyPublication)
      socialFail('SOCIAL_HOSTED_MEDIA_UNVERIFIED');
    await this.transferVerifier.verifyPublication(
      op.transferEvidence,
      op.mediaHash,
    );
    this.manual.validateForPublication(op.packageHash);
    return this.#post(
      op,
      'PUBLISHING',
      'PUBLISH',
      (): any =>
        this.publisher.publish({
          accountId: op.accountId,
          containerId: op.containerId,
        }),
      (receipt: any): any => ({
        state: 'PUBLISHED',
        mediaId: receipt.mediaId,
        uncertainStage: null,
        confirmationSource: 'PUBLISH_ACK',
      }),
    );
  }
  async reconcile(id: any): Promise<any> {
    let op: any = this.#get(id);
    if (['CREATING_CONTAINER', 'PUBLISHING'].includes(op.state))
      op = this.#transition(op, [op.state], {
        state: 'UNCERTAIN',
        uncertainStage: op.state === 'PUBLISHING' ? 'PUBLISH' : 'CREATE',
        errorCode: 'SOCIAL_INTERRUPTED_POST',
      }).value;
    if (op.state !== 'UNCERTAIN' || !op.containerId) return op;
    return this.#status(op, true);
  }
  async #status(op: any, reconcile: any): Promise<any> {
    let status: any;
    try {
      ({ status } = await this.publisher.getContainerStatus({
        containerId: op.containerId,
      }));
      if (
        !['IN_PROGRESS', 'FINISHED', 'PUBLISHED', 'ERROR', 'EXPIRED'].includes(
          status,
        )
      )
        socialFail('SOCIAL_STATUS_INVALID');
    } catch {
      return this.#transition(op, [op.state], {
        errorCode: 'SOCIAL_STATUS_UNAVAILABLE',
      }).value;
    }
    const state: any =
      status === 'PUBLISHED'
        ? 'PUBLISHED'
        : status === 'ERROR'
          ? 'FAILED'
          : status === 'EXPIRED'
            ? 'EXPIRED'
            : status === 'FINISHED' && !reconcile
              ? 'READY'
              : op.state;
    return this.#transition(op, [op.state], {
      state,
      errorCode: null,
      providerStatus: status,
      ...(state === 'PUBLISHED'
        ? { uncertainStage: null, confirmationSource: 'CONTAINER_STATUS' }
        : {}),
    }).value;
  }
}
