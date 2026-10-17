import {
  Injectable,
  HttpException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import {
  operationalQcIdentity,
  QC_REVIEWER_CONTEXT,
  serverApprovalRequest as deriveApproval,
  QcIdentityError,
} from './local-qc-identity.js';
export { QC_REVIEWER_CONTEXT } from './local-qc-identity.js';
function httpFailure(error: unknown): never {
  if (error instanceof QcIdentityError)
    throw new HttpException({ code: error.code }, error.status);
  throw new HttpException({ code: 'QC_IDENTITY_UNAVAILABLE' }, 503);
}
export function serverApprovalRequest(input: unknown, principal: unknown) {
  try {
    return deriveApproval(input, principal);
  } catch (error) {
    return httpFailure(error);
  }
}
@Injectable()
export class LocalQcGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    try {
      request[QC_REVIEWER_CONTEXT] = await operationalQcIdentity.authenticate(
        request.headers.authorization,
        request.socket.remoteAddress,
      );
      return true;
    } catch (error) {
      return httpFailure(error);
    }
  }
}
