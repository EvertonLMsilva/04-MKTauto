import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Inject,
  UseGuards,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  Req,
} from '@nestjs/common';
import { DestinationPublicationService } from './application/destination-publication.service.js';
import {
  LocalQcGuard,
  QC_REVIEWER_CONTEXT,
  serverApprovalRequest,
} from './application/local-qc.guard.js';
import { exact } from './domain/manual-distribution-contracts.js';
import type {
  FacebookSupersessionRequest,
  FacebookSuccessorAuthorization,
  FacebookOccurrenceAuthorization,
} from './domain/facebook-supersession.js';
@Controller('publishing/executions')
@UseGuards(LocalQcGuard)
export class DestinationPublicationController {
  constructor(
    @Inject(DestinationPublicationService)
    private readonly service: DestinationPublicationService,
  ) {}
  @Get(':id/destinations') status(@Param('id') id: string) {
    return this.service.status(id);
  }
  private async respond(action: () => unknown) {
    try {
      return await action();
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      const code = /^[A-Z_]+$/.test(error?.code ?? '')
        ? error.code
        : 'SOCIAL_PUBLICATION_UNAVAILABLE';
      if (
        [
          'DISTRIBUTION_INVALID_CONTRACT',
          'SOCIAL_SUPERSESSION_INVALID',
        ].includes(code)
      )
        throw new BadRequestException({ code });
      throw new ConflictException({ code });
    }
  }
  @Post(':id/facebook-reels/supersession')
  prepareSupersession(
    @Param('id') id: string,
    @Body()
    body: {
      accountId: string;
      input: Omit<FacebookSupersessionRequest, 'actor'>;
    },
    @Req() request: any,
  ) {
    return this.respond(() => {
      exact(body, ['accountId', 'input']);
      const input = serverApprovalRequest(
        body.input,
        request[QC_REVIEWER_CONTEXT],
      );
      return this.service.prepareFacebookSupersession(
        id,
        body.accountId,
        input as FacebookSupersessionRequest,
      );
    });
  }
  @Post(':id/facebook-reels/authorization')
  authorizeSuccessor(
    @Param('id') id: string,
    @Body()
    body: {
      accountId: string;
      expectedVersion: number;
      authorization: Omit<FacebookSuccessorAuthorization, 'actor'>;
    },
    @Req() request: any,
  ) {
    return this.respond(() => {
      exact(body, ['accountId', 'expectedVersion', 'authorization']);
      const authorization = serverApprovalRequest(
        body.authorization,
        request[QC_REVIEWER_CONTEXT],
      );
      return this.service.authorizeFacebookSuccessor(
        id,
        body.accountId,
        body.expectedVersion,
        authorization as FacebookSuccessorAuthorization,
      );
    });
  }
  @Post(':id/facebook-reels/prepare')
  prepareOccurrence(
    @Param('id') id: string,
    @Body() body: { accountId: string },
  ) {
    return this.respond(() => {
      exact(body, ['accountId']);
      return this.service.prepareFacebookOccurrence(id, body.accountId);
    });
  }
  @Post(':id/facebook-reels/occurrence-authorization')
  authorizeOccurrence(
    @Param('id') id: string,
    @Body()
    body: {
      accountId: string;
      expectedVersion: number;
      authorization: Omit<FacebookOccurrenceAuthorization, 'actor'>;
    },
    @Req() request: any,
  ) {
    return this.respond(() => {
      exact(body, ['accountId', 'expectedVersion', 'authorization']);
      exact(body.authorization, [
        'executionId',
        'operationId',
        'accountId',
        'packageHash',
        'campaignRevision',
        'expectedVersion',
        'authorizationId',
        'authorizedAt',
        'expiresAt',
      ]);
      const authorization = serverApprovalRequest(
        body.authorization,
        request[QC_REVIEWER_CONTEXT],
      );
      return this.service.authorizeFacebookOccurrence(
        id,
        body.accountId,
        body.expectedVersion,
        authorization as FacebookOccurrenceAuthorization,
      );
    });
  }
  @Post(':id/facebook-reels/reconcile')
  reconcileOccurrence(
    @Param('id') id: string,
    @Body()
    body: {
      accountId: string;
      expectedVersion: number;
      authorization: Omit<FacebookOccurrenceAuthorization, 'actor'>;
    },
    @Req() request: any,
  ) {
    return this.respond(() => {
      exact(body, ['accountId', 'expectedVersion', 'authorization']);
      exact(body.authorization, [
        'executionId',
        'operationId',
        'accountId',
        'packageHash',
        'campaignRevision',
        'expectedVersion',
        'authorizationId',
        'authorizedAt',
        'expiresAt',
      ]);
      const authorization = serverApprovalRequest(
        body.authorization,
        request[QC_REVIEWER_CONTEXT],
      );
      return this.service.reconcileFacebookOccurrence(
        id,
        body.accountId,
        body.expectedVersion,
        authorization as FacebookOccurrenceAuthorization,
      );
    });
  }
  @Post(':id/facebook-reels') async publish(
    @Param('id') id: string,
    @Body()
    body: {
      accountId: string;
      expectedVersion?: number;
      authorization?:
        FacebookSuccessorAuthorization | FacebookOccurrenceAuthorization;
    },
    @Req() request: any,
  ) {
    return this.respond(() => {
      if (!body || !Object.hasOwn(body, 'authorization')) {
        exact(body, ['accountId']);
        return this.service.execute(id, 'FACEBOOK_REELS', body.accountId);
      }
      exact(body, ['accountId', 'expectedVersion', 'authorization']);
      exact(
        body.authorization,
        'executionId' in body.authorization!
          ? [
              'executionId',
              'operationId',
              'accountId',
              'packageHash',
              'campaignRevision',
              'expectedVersion',
              'authorizationId',
              'actor',
              'authorizedAt',
              'expiresAt',
            ]
          : [
              'operationId',
              'packageHash',
              'preparationDecisionId',
              'authorizationId',
              'actor',
              'authorizedAt',
              'expiresAt',
              'acceptResidualRisk',
            ],
      );
      const { actor, ...input } = body.authorization!;
      const authorization = serverApprovalRequest(
        input,
        request[QC_REVIEWER_CONTEXT],
      );
      if (actor !== authorization.actor)
        throw new ForbiddenException({ code: 'QC_CLIENT_ACTOR_FORBIDDEN' });
      if (
        !Number.isSafeInteger(body.expectedVersion) ||
        body.expectedVersion! < 0
      )
        throw new BadRequestException({ code: 'SOCIAL_SUPERSESSION_INVALID' });
      return this.service.execute(
        id,
        'FACEBOOK_REELS',
        body.accountId,
        authorization as
          FacebookSuccessorAuthorization | FacebookOccurrenceAuthorization,
        body.expectedVersion,
      );
    });
  }
}
