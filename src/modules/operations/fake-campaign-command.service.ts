import { Inject, Injectable } from '@nestjs/common';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { CampaignAdministration } from '../content-operations/application/campaign-administration.js';
import { operationalQcIdentity } from '../publishing/application/local-qc-identity.js';
import {
  controlledFakeInput,
  controlledFakeRecurrenceInput,
  controlledFakeResumeInput,
  FAKE_COMMAND_RESULT_VERSION,
  registerFakeCampaignInput,
} from './fake-campaign-command.contract.js';

@Injectable()
export class FakeCampaignCommandService {
  constructor(
    @Inject(AffiliateService) private readonly affiliate: AffiliateService,
    @Inject(CampaignAdministration)
    private readonly campaigns: CampaignAdministration,
  ) {}
  async register(value: unknown, principal: unknown) {
    operationalQcIdentity.assertActive(principal);
    const campaign = await this.affiliate.registerCampaign(
      registerFakeCampaignInput(value),
    );
    return {
      schemaVersion: FAKE_COMMAND_RESULT_VERSION,
      mode: 'FAKE',
      result: 'CAMPAIGN_REGISTERED',
      campaign,
    };
  }
  async prepare(value: unknown, principal: unknown) {
    const actor = operationalQcIdentity.assertActive(principal);
    const execution = await this.campaigns.startControlledFake(
      controlledFakeInput(value),
      actor.id,
    );
    return {
      ...this.detail(execution.execution_id, principal),
      result: 'EXECUTION_ACCEPTED',
    };
  }
  detail(id: string, principal: unknown) {
    operationalQcIdentity.assertActive(principal);
    const { execution, policy } = this.campaigns.controlledFake(id);
    return {
      schemaVersion: FAKE_COMMAND_RESULT_VERSION,
      mode: policy.mode,
      result: 'EXECUTION_STATE',
      execution: {
        executionId: execution.execution_id,
        campaignId: execution.campaign_id,
        campaignRevision: execution.campaign_revision,
        runId: execution.run_id,
        status: execution.status,
        version: execution.version,
        scheduledAt: execution.scheduled_at,
        createdAt: execution.created_at,
        updatedAt: execution.updated_at,
      },
      policy,
    };
  }
  async configureRecurrence(value: unknown, principal: unknown) {
    const actor = operationalQcIdentity.assertActive(principal);
    const { execution, recurrence } =
      await this.campaigns.configureControlledFakeRecurrence(
        controlledFakeRecurrenceInput(value),
        actor.id,
      );
    return {
      ...this.detail(execution.execution_id, principal),
      result: 'RECURRENCE_CONFIGURED',
      recurrence,
    };
  }
  async resume(id: string, value: unknown, principal: unknown) {
    operationalQcIdentity.assertActive(principal);
    await this.campaigns.resumeControlledFake(
      id,
      controlledFakeResumeInput(value),
    );
    return this.detail(id, principal);
  }
}
