import { Injectable, HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import {
  LocalQcGuard,
  QC_REVIEWER_CONTEXT,
} from '../publishing/application/local-qc.guard.js';
import { operationalQcSessions } from '../publishing/application/local-qc-session.js';
import {
  operationalQcIdentity,
  QcIdentityError,
} from '../publishing/application/local-qc-identity.js';

/** Opt-in local browser commands. Reuses the real QC guard/session, and requires
 * an explicit server-side operator grant. Bearer authentication alone cannot
 * skip the browser session or its official x-qc-csrf check. */
@Injectable()
export class FakeCampaignCommandGuard extends LocalQcGuard {
  override async canActivate(context: ExecutionContext) {
    context.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
    await super.canActivate(context);
    try {
      const req = context.switchToHttp().getRequest();
      const browserPrincipal = operationalQcSessions.authenticate(req);
      const principal = operationalQcIdentity.assertActive(
        req[QC_REVIEWER_CONTEXT],
      );
      if (principal.id !== browserPrincipal.id)
        throw new QcIdentityError('QC_FAKE_COMMAND_OPERATOR_REQUIRED', 403);
      const raw = process.env.QC_FAKE_COMMAND_OPERATORS ?? '';
      const operators = raw.split(',');
      if (
        process.env.QC_FAKE_COMMANDS_ENABLED !== 'true' ||
        !raw ||
        operators.length > 100 ||
        operators.some((id) => !/^[a-z][a-z0-9_]{2,63}$/.test(id)) ||
        new Set(operators).size !== operators.length
      )
        throw new QcIdentityError(
          'QC_FAKE_COMMAND_CONFIGURATION_REQUIRED',
          503,
        );
      if (!operators.includes(principal.id))
        throw new QcIdentityError('QC_FAKE_COMMAND_OPERATOR_REQUIRED', 403);
      return true;
    } catch (error) {
      if (error instanceof QcIdentityError)
        throw new HttpException({ code: error.code }, error.status);
      throw new HttpException({ code: 'QC_IDENTITY_UNAVAILABLE' }, 503);
    }
  }
}
