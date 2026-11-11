import { writeFile, realpath as resolveRealPath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash,
  createHmac,
} from 'node:crypto';

const trusted = new WeakSet<object>();
const root = fileURLToPath(new URL('../../../../', import.meta.url));
export class QcIdentityError extends Error {
  readonly field = 'identity';
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}
const fail = (code: string, status = 401): never => {
  throw new QcIdentityError(code, status);
};
export interface QcReviewer {
  readonly id: string;
  readonly credentialHash: string;
}
interface Identity {
  id: string;
  salt: string;
  hash: string;
  roles: string[];
  revoked: boolean;
}
export const QC_REVIEWER_CONTEXT = Symbol('QC_REVIEWER_CONTEXT');
export function assertQcReviewer(input: unknown): QcReviewer {
  if (!input || typeof input !== 'object' || !trusted.has(input))
    return fail('QC_AUTHENTICATION_REQUIRED');
  return input as QcReviewer;
}
function externalPath(path: string) {
  if (
    !isAbsolute(path) ||
    resolve(path)
      .toLowerCase()
      .startsWith(resolve(root).toLowerCase() + sep)
  )
    fail('QC_IDENTITY_CONFIGURATION_REQUIRED', 503);
}
async function derive(secret: string, salt: string): Promise<Buffer> {
  return new Promise((resolveHash, reject) =>
    scrypt(
      secret,
      Buffer.from(salt, 'hex'),
      64,
      { N: 32768, r: 8, p: 1, maxmem: 67108864 },
      (error, hash) => (error ? reject(error) : resolveHash(hash)),
    ),
  );
}
export class LocalQcIdentity {
  private window = 0;
  private attempts = 0;
  private failures = 0;
  private active = 0;
  private windowPath: string | undefined;
  constructor(
    private readonly path = () => process.env.QC_IDENTITIES_FILE,
    private readonly now = Date.now,
  ) {}
  private identities(): Identity[] {
    const path = this.path();
    if (!path) return fail('QC_IDENTITY_CONFIGURATION_REQUIRED', 503);
    externalPath(path);
    try {
      const info = lstatSync(path);
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        info.isSymbolicLink() ||
        info.size > 65536 ||
        realpathSync(path) !== resolve(path) ||
        (process.platform !== 'win32' && info.mode & 0o077)
      )
        throw new Error();
      const value = JSON.parse(readFileSync(path, 'utf8'));
      if (
        Object.keys(value).sort().join(',') !== 'identities,version' ||
        value.version !== 1 ||
        !Array.isArray(value.identities) ||
        value.identities.length > 100 ||
        !value.identities.length
      )
        throw new Error();
      const ids = new Set<string>();
      for (const user of value.identities) {
        if (
          Object.keys(user).sort().join(',') !== 'hash,id,revoked,roles,salt' ||
          typeof user.id !== 'string' ||
          typeof user.salt !== 'string' ||
          typeof user.hash !== 'string' ||
          !/^[a-z][a-z0-9_]{2,63}$/.test(user.id) ||
          ids.has(user.id) ||
          !/^[a-f0-9]{32}$/.test(user.salt) ||
          !/^[a-f0-9]{128}$/.test(user.hash) ||
          typeof user.revoked !== 'boolean' ||
          !Array.isArray(user.roles) ||
          user.roles.some((role: string) => role !== 'QC_REVIEWER')
        )
          throw new Error();
        ids.add(user.id);
      }
      return value.identities;
    } catch {
      return fail('QC_IDENTITY_CONFIGURATION_REQUIRED', 503);
    }
  }
  async authenticate(
    header: unknown,
    address: string | undefined,
  ): Promise<QcReviewer> {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? ''))
      return fail('QC_LOCAL_ACCESS_REQUIRED', 403);
    const now = this.now();
    if (this.windowPath !== this.path() || now - this.window >= 60000) {
      this.windowPath = this.path();
      this.window = now;
      this.attempts = 0;
      this.failures = 0;
    }
    if (++this.attempts > 30 || this.failures >= 5 || this.active >= 2)
      return fail('QC_AUTH_RATE_LIMIT', 429);
    this.active++;
    try {
      const match =
        typeof header === 'string' &&
        /^Bearer ([a-z][a-z0-9_]{2,63})\.([A-Za-z0-9_-]{43})$/.exec(header);
      if (!match) {
        this.failures++;
        return fail('QC_AUTHENTICATION_REQUIRED');
      }
      const users = this.identities();
      const user = users.find((candidate) => candidate.id === match[1]);
      const actual = await derive(match[2], user?.salt ?? '0'.repeat(32));
      if (
        !user ||
        !timingSafeEqual(actual, Buffer.from(user.hash, 'hex')) ||
        user.revoked
      ) {
        this.failures++;
        return fail('QC_AUTHENTICATION_REQUIRED');
      }
      if (!user.roles.includes('QC_REVIEWER'))
        return fail('QC_REVIEWER_REQUIRED', 403);
      const principal = Object.freeze({
        id: user.id,
        credentialHash: user.hash,
      });
      trusted.add(principal);
      return principal;
    } finally {
      this.active--;
    }
  }
  fingerprint(principal: QcReviewer) {
    return createHash('sha256').update(principal.credentialHash).digest('hex');
  }
  signReview(value: unknown, body: string): string {
    const principal = assertQcReviewer(value);
    const user = this.identities().find(
      (candidate) => candidate.id === principal.id,
    );
    if (
      !user ||
      user.revoked ||
      user.hash !== principal.credentialHash ||
      !user.roles.includes('QC_REVIEWER')
    )
      return fail('QC_REVIEWER_REQUIRED', 403);
    return createHmac('sha256', Buffer.from(user.hash, 'hex'))
      .update('human-temporal-review/1.0.0\n' + body)
      .digest('hex');
  }
  verifyReview(
    actor: string,
    fingerprint: string,
    body: string,
    signature: string,
  ): boolean {
    try {
      const user = this.identities().find(
        (candidate) => candidate.id === actor,
      );
      if (
        !user ||
        user.revoked ||
        !user.roles.includes('QC_REVIEWER') ||
        !/^[a-f0-9]{64}$/.test(signature) ||
        this.fingerprint({ id: user.id, credentialHash: user.hash }) !==
          fingerprint
      )
        return false;
      const expected = createHmac('sha256', Buffer.from(user.hash, 'hex'))
        .update('human-temporal-review/1.0.0\n' + body)
        .digest();
      return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
    } catch {
      return false;
    }
  }
  assertActive(value: unknown): QcReviewer {
    const principal = assertQcReviewer(value);
    const user = this.identities().find(
      (candidate) => candidate.id === principal.id,
    );
    if (
      !user ||
      user.revoked ||
      user.hash !== principal.credentialHash ||
      !user.roles.includes('QC_REVIEWER')
    )
      return fail('QC_REVIEWER_REQUIRED', 403);
    return principal;
  }
}
export function serverApprovalRequest(input: unknown, principal: unknown) {
  const reviewer = operationalQcIdentity.assertActive(principal);
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.hasOwn(input, 'actor')
  )
    return fail('QC_CLIENT_ACTOR_FORBIDDEN', 400);
  return { ...input, actor: reviewer.id };
}
export const operationalQcIdentity = new LocalQcIdentity();
/** Operator-only provisioning. No HTTP route and no secret returned or logged.
 * Protect both destination directories with OS account ACLs before invoking.
 */
export async function provisionQcReviewer(
  configPath: string,
  id: string,
  secretPath: string,
) {
  externalPath(configPath);
  externalPath(secretPath);
  if (
    !/^[a-z][a-z0-9_]{2,63}$/.test(id) ||
    resolve(configPath) === resolve(secretPath)
  )
    throw new Error('QC_PROVISIONING_INVALID');
  for (const path of [configPath, secretPath]) {
    const parent = await resolveRealPath(dirname(path));
    externalPath(parent);
    if (parent !== resolve(dirname(path)))
      throw new Error('QC_PROVISIONING_INVALID');
  }
  const protect = (path: string) => {
    if (process.platform === 'win32') {
      const identity = execFileSync(
        'whoami.exe',
        ['/user', '/fo', 'csv', '/nh'],
        { encoding: 'utf8', windowsHide: true },
      );
      const sid = identity.match(/"(S-1-[0-9-]+)"/)?.[1];
      if (!sid) throw new Error('QC_PROVISIONING_INVALID');
      execFileSync(
        'icacls.exe',
        [path, '/inheritance:r', '/grant:r', '*' + sid + ':(F)'],
        { stdio: 'ignore', windowsHide: true },
      );
    }
  };
  const secret = randomBytes(32).toString('base64url'),
    salt = randomBytes(16).toString('hex');
  const hash = (await derive(secret, salt)).toString('hex');
  // Exclusive creation never overwrites an operator file. For multiple reviewers,
  // combine the individual hashed records under the same protected configuration.
  await writeFile(secretPath, id + '.' + secret, { flag: 'wx', mode: 0o600 });
  protect(secretPath);
  await writeFile(
    configPath,
    JSON.stringify({
      version: 1,
      identities: [{ id, salt, hash, roles: ['QC_REVIEWER'], revoked: false }],
    }),
    { flag: 'wx', mode: 0o600 },
  );
  protect(configPath);
}
