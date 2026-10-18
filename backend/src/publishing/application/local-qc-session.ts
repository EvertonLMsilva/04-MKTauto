import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import {
  LocalQcIdentity,
  operationalQcIdentity,
  QcIdentityError,
  type QcReviewer,
} from './local-qc-identity.js';

export interface QcBrowserRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string; encrypted?: boolean };
}
const COOKIE = 'mkt_qc_session';
const TTL = 30 * 60 * 1000;
const failure = (code: string, status = 403): never => {
  throw new QcIdentityError(code, status);
};
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/** Opaque, short-lived sessions never retain the operator's raw credential.
 * A restart requires login again; human decisions remain in existing SQLite storage. */
export class LocalQcSessions {
  private readonly sessions = new Map<
    string,
    { principal: QcReviewer; csrf: string; expires: number }
  >();
  constructor(
    private readonly identity: LocalQcIdentity = operationalQcIdentity,
    private readonly now = Date.now,
  ) {}
  origin(request: QcBrowserRequest, mutation = true) {
    if (
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
        request.socket.remoteAddress ?? '',
      )
    )
      failure('QC_LOCAL_ACCESS_REQUIRED');
    const host = request.headers.host;
    if (
      typeof host !== 'string' ||
      !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host)
    )
      failure('QC_LOCAL_HOST_REQUIRED');
    const expected = `${request.socket.encrypted ? 'https' : 'http'}://${host}`;
    if (
      (mutation || request.headers.origin !== undefined) &&
      request.headers.origin !== expected
    )
      failure('QC_ORIGIN_REQUIRED');
    if (
      request.headers['sec-fetch-site'] &&
      !['same-origin', 'none'].includes(
        String(request.headers['sec-fetch-site']),
      )
    )
      failure('QC_ORIGIN_REQUIRED');
  }
  async login(input: unknown, request: QcBrowserRequest) {
    this.origin(request);
    const value = input as { operatorId?: string; secret?: string };
    if (
      !value ||
      Object.keys(value).sort().join(',') !== 'operatorId,secret' ||
      typeof value.operatorId !== 'string' ||
      typeof value.secret !== 'string' ||
      value.secret.length > 128
    )
      failure('QC_AUTHENTICATION_REQUIRED', 401);
    const principal = await this.identity.authenticate(
      `Bearer ${value.operatorId}.${value.secret}`,
      request.socket.remoteAddress,
    );
    for (const [id, session] of this.sessions)
      if (session.expires <= this.now()) this.sessions.delete(id);
    if (this.sessions.size >= 100) failure('QC_AUTH_RATE_LIMIT', 429);
    this.remove(request);
    const token = randomBytes(32).toString('base64url'),
      csrfToken = randomBytes(32).toString('base64url');
    this.sessions.set(digest(token), {
      principal,
      csrf: csrfToken,
      expires: this.now() + TTL,
    });
    return {
      cookie: this.cookie(request, token, TTL / 1000),
      csrfToken,
      operatorId: principal.id,
    };
  }
  private token(request: QcBrowserRequest) {
    const raw = request.headers.cookie;
    if (typeof raw !== 'string' || raw.length > 8192) return '';
    const found = raw
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(COOKIE + '='));
    if (found.length !== 1) return '';
    const token = found[0].slice(COOKIE.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
  }
  authenticate(request: QcBrowserRequest): QcReviewer {
    const mutation = !['GET', 'HEAD'].includes(request.method);
    this.origin(request, mutation);
    const key = digest(this.token(request)),
      session = this.sessions.get(key);
    if (!session || session.expires <= this.now()) {
      this.sessions.delete(key);
      return failure('QC_SESSION_EXPIRED', 401);
    }
    const csrf = request.headers['x-qc-csrf'];
    if (
      mutation &&
      (typeof csrf !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(csrf) ||
        !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf)))
    )
      failure('QC_CSRF_REQUIRED');
    try {
      return this.identity.assertActive(session.principal);
    } catch (error) {
      this.sessions.delete(key);
      throw error;
    }
  }
  current(request: QcBrowserRequest) {
    const principal = this.authenticate(request);
    return {
      operatorId: principal.id,
      csrfToken: this.sessions.get(digest(this.token(request)))!.csrf,
    };
  }
  logout(request: QcBrowserRequest) {
    this.authenticate(request);
    this.remove(request);
    return this.cookie(request, '', 0);
  }
  private remove(request: QcBrowserRequest) {
    this.sessions.delete(digest(this.token(request)));
  }
  private cookie(request: QcBrowserRequest, token: string, maxAge: number) {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${request.socket.encrypted ? '; Secure' : ''}`;
  }
}
export const operationalQcSessions = new LocalQcSessions();
