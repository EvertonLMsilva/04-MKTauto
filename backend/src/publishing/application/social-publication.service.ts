import { requireSocialPublisherPort } from '../application/ports/social-publisher-port.js';
import { affiliateHash } from '../../affiliate/domain/affiliate-contracts.js';
import { createHash } from 'node:crypto';
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
    authorize = (_op: any) => {},
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
      authorize,
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
    if (
      value.uploadStrategy &&
      !(
        value.publicationFlowVersion === 2 &&
        value.uploadStrategy === 'facebook-login-resumable/experimental'
      )
    )
      socialFail('SOCIAL_EXECUTION_STRATEGY_MISMATCH');
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
  async prepare(
    raw: any,
    key: any,
    source: 'url' | 'local' = 'url',
  ): Promise<any> {
    this.#boundary();
    const v: any = validateSocialPrepare(raw),
      { p, caption } = await this.#gate(v.packageHash, v.accountId);
    return this.repository.prepare(
      {
        ...v,
        mediaHash: p.identity.videoRenderContentHash,
        caption,
        ...(source === 'local'
          ? {
              publicationFlowVersion: 2,
              uploadStrategy: 'facebook-login-resumable/experimental',
            }
          : {}),
      },
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
    this.manual.validateForPublication(op.packageHash);
    this.authorize(op);
    this.repository.authorizePublication(op, this.now());
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
    } catch (error: any) {
      const code =
        /^SOCIAL_(AUTH_REQUIRED|RATE_LIMIT|PERMISSION_REQUIRED|API_REJECTED|NETWORK_UNCERTAIN|RESPONSE_UNCERTAIN|REMOTE_UNCERTAIN|RECEIPT_INVALID)$/.test(
          error?.code,
        )
          ? error.code
          : 'SOCIAL_POST_UNCONFIRMED';
      return this.#transition(claim.value, [intent], {
        state: 'UNCERTAIN',
        uncertainStage: stage,
        errorCode: code,
        retryAfterSeconds:
          Number.isSafeInteger(error?.retryAfterSeconds) &&
          error.retryAfterSeconds >= 0 &&
          error.retryAfterSeconds <= 86400
            ? error.retryAfterSeconds
            : null,
      }).value;
    }
    // Database failures propagate. The persisted intent remains recoverable;
    // never disguise a failed receipt commit as an HTTP failure or resend.
    try {
      this.manual.validateForPublication(op.packageHash);
      this.authorize(op);
    } catch {
      patch.requiresReconciliation = true;
    }
    return this.#transition(claim.value, [intent], patch).value;
  }
  async createContainer(id: any, transfer?: any): Promise<any> {
    const op: any = this.#get(id);
    if (op.state !== 'PREPARED') return op;
    const { caption } = await this.#gate(op.packageHash, op.accountId);
    if (op.publicationFlowVersion === 2) {
      if (transfer !== undefined || !this.publisher.createResumableContainer)
        socialFail('SOCIAL_TRANSFER_INVALID');
      return this.#post(
        op,
        'CREATING_CONTAINER',
        'CREATE',
        () =>
          this.publisher.createResumableContainer({
            accountId: op.accountId,
            caption,
          }),
        (receipt: any) => ({
          state: 'PROCESSING',
          containerId: receipt.containerId,
          uploadUri: receipt.uploadUri,
          uploadStage: 'PENDING',
          uncertainStage: null,
        }),
      );
    }
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
  async upload(id: string, bytes: Buffer) {
    const op = this.#get(id);
    if (
      op.publicationFlowVersion !== 2 ||
      op.state !== 'PROCESSING' ||
      op.uploadStage !== 'PENDING' ||
      !op.uploadUri ||
      !Buffer.isBuffer(bytes) ||
      createHash('sha256').update(bytes).digest('hex') !== op.mediaHash
    )
      socialFail('SOCIAL_MEDIA_INCOMPATIBLE');
    this.#mutationAllowed();
    await this.#gate(op.packageHash, op.accountId);
    this.authorize(op);
    this.repository.authorizePublication(op, this.now());
    const claim = this.#transition(op, ['PROCESSING'], {
      state: 'PROCESSING',
      uploadStage: 'UPLOADING',
    });
    if (!claim.claimed) return claim.value;
    try {
      await this.publisher.uploadResumableBytes(op.uploadUri, bytes);
    } catch (error: any) {
      return this.#transition(claim.value, ['PROCESSING'], {
        state: 'UNCERTAIN',
        uncertainStage: 'UPLOAD',
        errorCode: /^SOCIAL_[A-Z_]+$/.test(error?.code ?? '')
          ? error.code
          : 'SOCIAL_POST_UNCONFIRMED',
      }).value;
    }
    const proof = {
      executionMode: this.publisher.mode,
      contentHash: op.mediaHash,
      operationId: op.operationId,
      containerId: op.containerId,
    };
    let requiresReconciliation = false;
    try {
      this.manual.validateForPublication(op.packageHash);
      this.authorize(op);
    } catch {
      requiresReconciliation = true;
    }
    return this.#transition(claim.value, ['PROCESSING'], {
      state: 'PROCESSING',
      uploadStage: 'ACKNOWLEDGED',
      transferEvidence: { ...proof, evidenceHash: affiliateHash(proof) },
      requiresReconciliation,
    }).value;
  }
  async process(id: any): Promise<any> {
    const op: any = this.#get(id);
    if (op.state !== 'PROCESSING') return op;
    if (op.publicationFlowVersion === 2 && op.uploadStage !== 'ACKNOWLEDGED')
      return op;
    return this.#status(op, false);
  }
  async publish(id: any): Promise<any> {
    const op: any = this.#get(id);
    if (op.state !== 'READY') return op;
    await this.#gate(op.packageHash, op.accountId);
    this.#mutationAllowed();
    if (op.publicationFlowVersion === 2) {
      const { evidenceHash, ...proof } = op.transferEvidence ?? {};
      if (
        op.uploadStage !== 'ACKNOWLEDGED' ||
        op.providerStatus !== 'FINISHED' ||
        op.requiresReconciliation ||
        proof.operationId !== op.operationId ||
        proof.containerId !== op.containerId ||
        proof.contentHash !== op.mediaHash ||
        affiliateHash(proof) !== evidenceHash
      )
        socialFail('SOCIAL_HOSTED_MEDIA_UNVERIFIED');
    } else if (!this.transferVerifier?.verifyPublication)
      socialFail('SOCIAL_HOSTED_MEDIA_UNVERIFIED');
    if (op.publicationFlowVersion !== 2)
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
  async receipt(id: string): Promise<any> {
    const op = this.#get(id);
    if (op.state !== 'PUBLISHED' || !op.mediaId || !this.publisher.getMedia)
      return op;
    const receipt = await this.publisher.getMedia({ mediaId: op.mediaId });
    return this.#transition(op, ['PUBLISHED'], {
      remoteReceipt: receipt,
      requiresReconciliation: false,
    }).value;
  }
  async reconcile(id: any): Promise<any> {
    let op: any = this.#get(id);
    if (['CREATING_CONTAINER', 'PUBLISHING'].includes(op.state))
      op = this.#transition(op, [op.state], {
        state: 'UNCERTAIN',
        uncertainStage: op.state === 'PUBLISHING' ? 'PUBLISH' : 'CREATE',
        errorCode: 'SOCIAL_INTERRUPTED_POST',
      }).value;
    if (
      op.requiresReconciliation &&
      ['PROCESSING', 'READY'].includes(op.state)
    ) {
      if (op.publicationFlowVersion === 2) {
        try {
          await this.#gate(op.packageHash, op.accountId);
          this.authorize(op);
          this.repository.authorizePublication(op, this.now());
        } catch {
          return op;
        }
      }
      return this.#status(op, true);
    }
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
    } catch (error: any) {
      return this.#transition(op, [op.state], {
        errorCode:
          /^SOCIAL_(AUTH_REQUIRED|RATE_LIMIT|PERMISSION_REQUIRED)$/.test(
            error?.code,
          )
            ? error.code
            : 'SOCIAL_STATUS_UNAVAILABLE',
      }).value;
    }
    if (
      op.publicationFlowVersion === 2 &&
      status === 'PUBLISHED' &&
      op.state !== 'PUBLISHING' &&
      op.uncertainStage !== 'PUBLISH'
    )
      return this.#transition(op, [op.state], {
        providerStatus: status,
        errorCode: 'SOCIAL_RECONCILIATION_REQUIRED',
        requiresReconciliation: true,
      }).value;
    if (op.publicationFlowVersion === 2 && op.uncertainStage === 'UPLOAD') {
      if (status === 'FINISHED') {
        try {
          await this.#gate(op.packageHash, op.accountId);
          this.authorize(op);
          this.repository.authorizePublication(op, this.now());
        } catch {
          return this.#transition(op, ['UNCERTAIN'], {
            providerStatus: status,
            requiresReconciliation: true,
          }).value;
        }
        const proof = {
          executionMode: this.publisher.mode,
          contentHash: op.mediaHash,
          operationId: op.operationId,
          containerId: op.containerId,
        };
        return this.#transition(op, ['UNCERTAIN'], {
          state: 'READY',
          uploadStage: 'ACKNOWLEDGED',
          providerStatus: status,
          transferEvidence: { ...proof, evidenceHash: affiliateHash(proof) },
          uncertainStage: null,
          errorCode: null,
          requiresReconciliation: false,
        }).value;
      }
      return this.#transition(op, ['UNCERTAIN'], { providerStatus: status })
        .value;
    }
    const state: any =
      status === 'PUBLISHED'
        ? 'PUBLISHED'
        : status === 'ERROR'
          ? 'FAILED'
          : status === 'EXPIRED'
            ? 'EXPIRED'
            : status === 'FINISHED' &&
                (!reconcile || op.publicationFlowVersion === 2)
              ? 'READY'
              : op.state;
    return this.#transition(op, [op.state], {
      state,
      errorCode: null,
      providerStatus: status,
      ...(reconcile ? { requiresReconciliation: false } : {}),
      ...(state === 'PUBLISHED'
        ? { uncertainStage: null, confirmationSource: 'CONTAINER_STATUS' }
        : {}),
    }).value;
  }
}
