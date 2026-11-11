import {
  validateSupersessionRequest,
  assertSupersessionObservation,
  observationFingerprint,
} from '../domain/facebook-supersession.js';
import type {
  FacebookSupersessionRequest,
  FacebookSuccessorAuthorization,
  FacebookOccurrenceAuthorization,
} from '../domain/facebook-supersession.js';
import type { CampaignOperationsPort } from '../../content-operations/application/campaign-operations.port.js';
import type { FinanceService } from '../../finance/application/finance.service.js';
import type { OperationalAlertsService } from '../../notifications/application/operational-alerts.service.js';
import type {
  DestinationPublicationStore,
  FacebookPublicationPorts,
  PublicationNetwork,
} from './ports/destination-publication.port.js';
import { SocialPublicationService } from './social-publication.service.js';
import { socialFail } from '../domain/social-publication-contracts.js';
import type { FacebookCreateAcknowledgement } from '../domain/facebook-upload-session.js';
import { projectOperationalQueue } from './operational-queue.js';

// Explicit distribution of existing, approved media. No timer and no production pipeline.
export class DestinationPublicationService {
  constructor(
    private readonly store: DestinationPublicationStore,
    private readonly campaigns: CampaignOperationsPort,
    private readonly facebook: FacebookPublicationPorts | null,
    private readonly finance: Pick<FinanceService, 'getGlobalOperation'>,
    private readonly notifications?: Pick<OperationalAlertsService, 'scan'>,
    private readonly now = () => new Date().toISOString(),
  ) {}
  status(id: string) {
    return this.store.readDestinations(id);
  }
  queue(limit = 25, offset = 0) {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      socialFail('SOCIAL_QUEUE_PAGINATION_INVALID');
    return projectOperationalQueue(
      this.store.readOperationalQueue(limit, offset),
      limit,
      offset,
      this.now(),
    );
  }
  private context(id: string) {
    const s = this.campaigns.open();
    try {
      const e = s.facts(id)[0];
      if (!e) socialFail('SOCIAL_EXECUTION_NOT_FOUND');
      return { execution: e, request: s.audit(id)[0]?.evidence ?? {} };
    } finally {
      s.close();
    }
  }
  async reconcileFacebookSession(
    id: string,
    account: string,
    ack: FacebookCreateAcknowledgement,
  ) {
    const ports = this.facebook;
    if (
      !ports ||
      ports.publisher.accountId !== 'facebook_reels:' + account ||
      ack.pageId !== account
    )
      socialFail('SOCIAL_DESTINATION_INVALID');
    const { execution } = this.context(id);
    const s = this.store.openDestination(ports.publisher.mode);
    try {
      const reservation =
        s.reservations.activeForExecution?.(id, 'FACEBOOK_REELS', account) ??
        s.reservations.forExecution(id, 'FACEBOOK_REELS', account);
      if (!reservation || reservation.operationId !== ack.operationId)
        socialFail('SOCIAL_SESSION_EVIDENCE_INVALID');
      const op = s.social.get(ack.operationId);
      if (!op) socialFail('SOCIAL_OPERATION_NOT_FOUND');
      s.manual.validateForPublication(op.packageHash, execution);
      const engine = new SocialPublicationService({
        repository: s.social,
        manual: s.manual,
        publisher: ports.publisher,
        media: ports.media,
        transferVerifier: ports.verifier,
        allowLivePosts: false,
        now: this.now,
        authorize: (value: any) => s.reservations.authorize(value, this.now()),
      });
      return await engine.recoverUploadSession(ack.operationId, ack);
    } finally {
      s.close();
    }
  }
  async prepareFacebookSupersession(
    id: string,
    account: string,
    raw: FacebookSupersessionRequest,
  ) {
    const command = validateSupersessionRequest(raw),
      ports = this.facebook;
    if (
      !ports?.publisher.inspectUploadSession ||
      ports.publisher.accountId !== 'facebook_reels:' + account
    )
      socialFail('SOCIAL_DESTINATION_INVALID');
    const s = this.store.openDestination(ports.publisher.mode);
    try {
      const op = s.social.get(command.originalOperationId);
      if (!op || op.accountId !== ports.publisher.accountId)
        socialFail('SOCIAL_DESTINATION_INVALID');
      const lineage = s.social.lineage(op.operationId),
        rootId = lineage?.root_operation_id ?? op.operationId;
      const reservation = s.reservations.forExecution(
        id,
        'FACEBOOK_REELS',
        account,
      );
      if (!reservation || reservation.operationId !== rootId)
        socialFail('SOCIAL_RESERVATION_CONFLICT');
      const replay = s.social.supersessionReplay(command);
      if (replay) return replay;
      const revalidate = () => {
        const { execution, request } = this.context(id);
        if (execution.status === 'RUNNING')
          socialFail('SOCIAL_SUPERSESSION_ACTIVE_CLAIM');
        s.manual.validateForPublication(op.packageHash, execution);
        const recovery = request.legacyRecovery as
          { financialOperationIds?: string[] } | undefined;
        for (const financialId of recovery?.financialOperationIds ??
          [request.generationRequestId].filter(
            (v): v is string => typeof v === 'string',
          ))
          if (this.finance.getGlobalOperation(financialId)?.state === 'UNKNOWN')
            socialFail('SOCIAL_FINANCE_RECONCILIATION_REQUIRED');
      };
      revalidate();
      const engine = new SocialPublicationService({
        repository: s.social,
        manual: s.manual,
        publisher: ports.publisher,
        media: ports.media,
        transferVerifier: ports.verifier,
        now: this.now,
      });
      const evidence = await engine.inspectSupersessionLineage(
        op.operationId,
        true,
      );
      const remote = evidence.at(-1)!.observation;
      assertSupersessionObservation(
        command.remoteObservation,
        op,
        s.social.history(op.operationId),
        this.now(),
      );
      assertSupersessionObservation(
        remote,
        op,
        s.social.history(op.operationId),
        this.now(),
      );
      if (
        observationFingerprint(command.remoteObservation) !==
        observationFingerprint(remote)
      )
        socialFail('SOCIAL_SUPERSESSION_OBSERVATION_CHANGED');
      return s.social.prepareSupersession(
        command,
        () => this.now(),
        revalidate,
        evidence,
      );
    } finally {
      s.close();
    }
  }
  async authorizeFacebookSuccessor(
    id: string,
    account: string,
    expectedVersion: number,
    raw: FacebookSuccessorAuthorization,
  ) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)
      socialFail('SOCIAL_SUPERSESSION_INVALID');
    if (!raw || typeof raw !== 'object')
      socialFail('SOCIAL_SUCCESSOR_AUTHORIZATION_REQUIRED');
    const authorization = structuredClone(raw),
      ports = this.facebook;
    if (!ports || ports.publisher.accountId !== 'facebook_reels:' + account)
      socialFail('SOCIAL_DESTINATION_INVALID');
    const s = this.store.openDestination(ports.publisher.mode);
    try {
      const op = s.social.get(authorization.operationId);
      if (!op) socialFail('SOCIAL_SUCCESSOR_AUTHORIZATION_REQUIRED');
      s.social.assertNotSuperseded(op.operationId);
      if (
        !op.supersession ||
        op.accountId !== ports.publisher.accountId ||
        ['FAILED', 'EXPIRED'].includes(op.state) ||
        (op.state === 'PUBLISHED' &&
          (op.remoteReceipt || op.mediaId !== op.containerId))
      )
        socialFail('SOCIAL_SUPERSESSION_INELIGIBLE');
      const revalidate = () => {
        const current = s.social.get(op.operationId);
        if (
          current?.version !== expectedVersion ||
          current.contentHash !== op.contentHash
        )
          socialFail('SOCIAL_SUPERSESSION_CONFLICT');
        const active = s.reservations.activeForExecution?.(
          id,
          'FACEBOOK_REELS',
          account,
        );
        if (!active || active.operationId !== current.operationId)
          socialFail('SOCIAL_RESERVATION_CONFLICT');
        const { execution, request } = this.context(id);
        if (execution.status === 'RUNNING')
          socialFail('SOCIAL_SUPERSESSION_ACTIVE_CLAIM');
        s.manual.validateForPublication(current.packageHash, execution);
        const recovery = request.legacyRecovery as
          { financialOperationIds?: string[] } | undefined;
        for (const financialId of recovery?.financialOperationIds ??
          [request.generationRequestId].filter(
            (v): v is string => typeof v === 'string',
          ))
          if (this.finance.getGlobalOperation(financialId)?.state === 'UNKNOWN')
            socialFail('SOCIAL_FINANCE_RECONCILIATION_REQUIRED');
        s.social.authorizePublication(current, this.now(), authorization);
      };
      revalidate();
      const engine = new SocialPublicationService({
        repository: s.social,
        manual: s.manual,
        publisher: ports.publisher,
        media: ports.media,
        transferVerifier: ports.verifier,
        now: this.now,
      });
      await engine.inspectSupersessionLineage(op.operationId);
      revalidate();
      // The existing scoped grant is returned for explicit execution. No local
      // authorization is persisted here; intent records it before external I/O.
      return {
        operationId: op.operationId,
        state: op.state,
        version: op.version,
        contentHash: op.contentHash,
        authorization,
      };
    } finally {
      s.close();
    }
  }
  async prepareFacebookOccurrence(id: string, account: string) {
    return this.execute(
      id,
      'FACEBOOK_REELS',
      account,
      undefined,
      undefined,
      true,
    );
  }
  async authorizeFacebookOccurrence(
    id: string,
    account: string,
    expectedVersion: number,
    authorization: FacebookOccurrenceAuthorization,
  ) {
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 ||
      authorization?.expectedVersion !== expectedVersion
    )
      socialFail('SOCIAL_FACEBOOK_AUTHORIZATION_REQUIRED');
    const ports = this.facebook;
    if (!ports || ports.publisher.accountId !== 'facebook_reels:' + account)
      socialFail('SOCIAL_DESTINATION_INVALID');
    const { execution, request } = this.context(id);
    if (execution.status === 'RUNNING')
      socialFail('SOCIAL_FACEBOOK_ACTIVE_CLAIM');
    const s = this.store.openDestination(ports.publisher.mode);
    try {
      const reservation =
        s.reservations.activeForExecution?.(id, 'FACEBOOK_REELS', account) ??
        s.reservations.forExecution(id, 'FACEBOOK_REELS', account);
      const op = reservation && s.social.get(reservation.operationId);
      const recoveryOnly =
        typeof authorization?.authorizationId === 'string' &&
        authorization.authorizationId.startsWith('recovery:');
      const needsRecovery =
        op &&
        (op.state === 'UNCERTAIN' ||
          op.requiresReconciliation ||
          (op.state === 'PUBLISHED' && !op.remoteReceipt));
      if (
        !op ||
        op.supersession ||
        op.executionAuthorizationRequired !== true ||
        op.version !== expectedVersion ||
        needsRecovery !== recoveryOnly ||
        (!needsRecovery &&
          !['PREPARED', 'PROCESSING', 'READY'].includes(op.state))
      )
        socialFail('SOCIAL_FACEBOOK_AUTHORIZATION_REQUIRED');
      s.manual.validateForPublication(op.packageHash, execution);
      const recovery = request.legacyRecovery as
        { financialOperationIds?: string[] } | undefined;
      for (const financialId of recovery?.financialOperationIds ??
        [request.generationRequestId].filter(
          (v): v is string => typeof v === 'string',
        ))
        if (this.finance.getGlobalOperation(financialId)?.state === 'UNKNOWN')
          socialFail('SOCIAL_FINANCE_RECONCILIATION_REQUIRED');
      s.social.authorizePublication(op, this.now(), authorization);
      return {
        operationId: op.operationId,
        state: op.state,
        version: op.version,
        contentHash: op.contentHash,
        authorization,
      };
    } finally {
      s.close();
    }
  }
  async reconcileFacebookOccurrence(
    id: string,
    account: string,
    expectedVersion: number,
    authorization: FacebookOccurrenceAuthorization,
  ) {
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 ||
      authorization?.expectedVersion !== expectedVersion ||
      typeof authorization?.authorizationId !== 'string' ||
      !authorization.authorizationId.startsWith('recovery:')
    )
      socialFail('SOCIAL_FACEBOOK_AUTHORIZATION_REQUIRED');
    const ports = this.facebook;
    if (!ports || ports.publisher.accountId !== 'facebook_reels:' + account)
      socialFail('SOCIAL_DESTINATION_INVALID');
    const { execution } = this.context(id);
    if (execution.status === 'RUNNING')
      socialFail('SOCIAL_FACEBOOK_ACTIVE_CLAIM');
    const s = this.store.openDestination(ports.publisher.mode);
    try {
      const reservation =
        s.reservations.activeForExecution?.(id, 'FACEBOOK_REELS', account) ??
        s.reservations.forExecution(id, 'FACEBOOK_REELS', account);
      const op = reservation && s.social.get(reservation.operationId);
      if (
        !op ||
        op.supersession ||
        op.executionAuthorizationRequired !== true ||
        op.version !== expectedVersion ||
        !(
          op.state === 'UNCERTAIN' ||
          op.requiresReconciliation ||
          (op.state === 'PUBLISHED' && !op.remoteReceipt)
        )
      )
        socialFail('SOCIAL_RECONCILIATION_REQUIRED');
      s.manual.validateForPublication(op.packageHash, execution);
      s.social.authorizePublication(op, this.now(), authorization);
      if (op.state === 'UNCERTAIN' && op.uncertainStage === 'PUBLISH') {
        // An inconclusive FINISH remains uncertain. A recovery grant never
        // converts it to READY, where a later execution could repeat FINISH.
        let status: string | undefined;
        try {
          status = (
            await ports.publisher.getContainerStatus({
              containerId: op.containerId,
            })
          ).status;
        } catch {
          return op;
        }
        if (status !== 'PUBLISHED') return op;
      }
      const engine = new SocialPublicationService({
        repository: s.social,
        manual: s.manual,
        publisher: ports.publisher,
        media: ports.media,
        transferVerifier: ports.verifier,
        allowLivePosts: false,
        operationalAuthorization: authorization,
        now: this.now,
        authorize: (value: any) => s.reservations.authorize(value, this.now()),
      });
      let observed = await engine.reconcile(op.operationId);
      if (
        observed.state === 'PUBLISHED' &&
        observed.mediaId &&
        !observed.remoteReceipt
      )
        observed = await engine.receipt(observed.operationId);
      return observed;
    } finally {
      s.close();
    }
  }
  async execute(
    id: string,
    network: PublicationNetwork,
    account: string,
    operationalAuthorization?:
      FacebookSuccessorAuthorization | FacebookOccurrenceAuthorization,
    expectedVersion?: number,
    prepareOnly = false,
  ): Promise<any> {
    if (network !== 'FACEBOOK_REELS' || !this.facebook)
      socialFail('SOCIAL_FACEBOOK_CONFIGURATION_REQUIRED');
    if (operationalAuthorization?.authorizationId.startsWith('recovery:'))
      socialFail('SOCIAL_FACEBOOK_AUTHORIZATION_REQUIRED');
    const ports = this.facebook,
      canonical = 'facebook_reels:' + account;
    if (ports.publisher.accountId !== canonical)
      socialFail('SOCIAL_DESTINATION_INVALID');
    const { execution: e, request } = this.context(id),
      s = this.store.openDestination(ports.publisher.mode);
    try {
      const prior =
          s.reservations.activeForExecution?.(id, network, account) ??
          s.reservations.forExecution(id, network, account),
        previous = prior ? s.social.get(prior.operationId) : null;
      if (
        operationalAuthorization &&
        operationalAuthorization.operationId !== previous?.operationId
      )
        socialFail('SOCIAL_SUCCESSOR_AUTHORIZATION_REQUIRED');
      if (
        previous?.state === 'PUBLISHED' &&
        previous.remoteReceipt &&
        !previous.requiresReconciliation
      ) {
        if (operationalAuthorization)
          s.social.authorizePublication(
            previous,
            this.now(),
            operationalAuthorization,
          );
        return this.result(previous);
      }
      if (
        expectedVersion !== undefined &&
        (!Number.isSafeInteger(expectedVersion) ||
          expectedVersion < 0 ||
          previous?.version !== expectedVersion)
      )
        socialFail('SOCIAL_SUPERSESSION_CONFLICT');
      if (
        previous &&
        s.social.lineage(previous.operationId)?.supersession_revision > 0
      )
        s.social.authorizePublication(
          previous,
          this.now(),
          operationalAuthorization,
        );
      const packages = s.manual.repository
        .list('PACKAGE')
        .filter(
          (p: any) =>
            p.platform === 'facebook' &&
            p.account === account &&
            p.identity.pipelineRunId === e.runId,
        );
      if (!previous && packages.length !== 1)
        socialFail(
          packages.length
            ? 'DISTRIBUTION_PACKAGE_AMBIGUOUS'
            : 'SOCIAL_PACKAGE_REQUIRED',
        );
      const pkg = s.manual.validateForPublication(
        previous?.packageHash ?? packages[0].contentHash,
        e,
      );
      const recurringTarget = Array.isArray(request.publication)
        ? request.publication.find(
            (item: any) => item?.network === 'FACEBOOK_REELS',
          )
        : null;
      if (
        recurringTarget &&
        (recurringTarget.accountId !== account ||
          recurringTarget.packageHash !== pkg.contentHash)
      )
        socialFail('SOCIAL_PUBLICATION_IDENTITY_CONFLICT');
      const recovery = request.legacyRecovery as
        { financialOperationIds?: string[] } | undefined;
      const financialIds =
        recovery?.financialOperationIds ??
        [request.generationRequestId].filter(
          (v): v is string => typeof v === 'string',
        );
      for (const operationId of financialIds)
        if (this.finance.getGlobalOperation(operationId)?.state === 'UNKNOWN')
          socialFail('SOCIAL_FINANCE_RECONCILIATION_REQUIRED');
      const localBytes = await ports.localBytes(
        pkg.contentHash,
        pkg.identity.videoRenderId,
        pkg.identity.videoRenderContentHash,
      );
      const engine = new SocialPublicationService({
        repository: s.social,
        manual: s.manual,
        publisher: ports.publisher,
        media: ports.media,
        transferVerifier: ports.verifier,
        allowLivePosts: ports.allowLivePosts ?? false,
        operationalAuthorization,
        now: this.now,
        authorize: (op: any) => s.reservations.authorize(op, this.now()),
      });
      let op = previous?.supersession
        ? previous
        : await engine.prepare(
            { packageHash: pkg.contentHash, accountId: canonical },
            `facebook_reels:${id}:${account}`,
            'local',
          );
      if (previous?.supersession) s.reservations.authorize(op, this.now());
      else
        s.reservations.reserve(
          id,
          op,
          pkg,
          s.manual.getReview(pkg.contentHash).contentHash,
          this.now(),
        );
      if (prepareOnly) {
        if (op.supersession)
          socialFail('SOCIAL_FACEBOOK_AUTHORIZATION_REQUIRED');
        return {
          operationId: op.operationId,
          state: op.state,
          version: op.version,
          packageHash: op.packageHash,
          accountId: account,
        };
      }
      s.social.authorizePublication(op, this.now(), operationalAuthorization);
      if (op.executionAuthorizationRequired === true && e.status === 'RUNNING')
        socialFail('SOCIAL_FACEBOOK_ACTIVE_CLAIM');
      if (
        ['CREATING_CONTAINER', 'PUBLISHING', 'UNCERTAIN'].includes(op.state) ||
        op.requiresReconciliation
      ) {
        op = await engine.reconcile(op.operationId);
        if (op.state === 'UNCERTAIN' || op.requiresReconciliation)
          socialFail('SOCIAL_RECONCILIATION_REQUIRED');
      }
      if (['PREPARED', 'PROCESSING', 'READY'].includes(op.state))
        await ports.verifyConnection?.();
      if (op.state === 'PREPARED')
        op = await engine.createContainer(op.operationId);
      if (op.state === 'PROCESSING' && op.uploadStage === 'UPLOADING') {
        await engine.reconcile(op.operationId);
        socialFail('SOCIAL_RECONCILIATION_REQUIRED');
      }
      if (op.state === 'PROCESSING' && op.uploadStage === 'PENDING')
        op = await engine.upload(op.operationId, localBytes);
      if (op.state === 'UNCERTAIN' || op.requiresReconciliation)
        socialFail('SOCIAL_RECONCILIATION_REQUIRED');
      if (op.state === 'PROCESSING') op = await engine.process(op.operationId);
      if (op.state === 'READY') op = await engine.publish(op.operationId);
      if (op.state === 'PUBLISHED') op = await engine.receipt(op.operationId);
      if (op.state === 'UNCERTAIN' || op.requiresReconciliation)
        socialFail('SOCIAL_RECONCILIATION_REQUIRED');
      if (op.state !== 'PUBLISHED' || !op.remoteReceipt)
        socialFail(op.errorCode ?? 'SOCIAL_PROCESSING_REQUIRED');
      return this.result(op);
    } finally {
      s.close();
      try {
        if (!prepareOnly) await this.notifications?.scan();
      } catch {
        /* Operational delivery cannot change publication outcome. */
      }
    }
  }
  private result(op: any) {
    return {
      operationId: op.operationId,
      network: 'FACEBOOK_REELS',
      mediaId: op.mediaId,
      receipt: op.remoteReceipt,
      cost: { status: 'UNKNOWN', amount: null },
    };
  }
}
