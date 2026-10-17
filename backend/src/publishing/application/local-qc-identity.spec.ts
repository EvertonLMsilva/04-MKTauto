import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, scryptSync } from 'node:crypto';
import { LocalQcIdentity, assertQcReviewer } from './local-qc-identity.js';

let root: string, file: string;
const secret = randomBytes(32).toString('base64url');
const salt = randomBytes(16).toString('hex');
const record = () => ({
  id: 'reviewer_001',
  salt,
  hash: scryptSync(secret, Buffer.from(salt, 'hex'), 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 67108864,
  }).toString('hex'),
  roles: ['QC_REVIEWER'],
  revoked: false,
});
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'qc-auth-'));
  file = join(root, 'identities.json');
  await writeFile(
    file,
    JSON.stringify({ version: 1, identities: [record()] }),
    { mode: 0o600 },
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it('authenticates an individual and rejects a caller-created principal', async () => {
  const auth = new LocalQcIdentity(() => file);
  const principal = await auth.authenticate(
    'Bearer reviewer_001.' + secret,
    '127.0.0.1',
  );
  expect(assertQcReviewer(principal).id).toBe('reviewer_001');
  expect(() =>
    assertQcReviewer({ id: 'reviewer_001', roles: ['QC_REVIEWER'] }),
  ).toThrow();
});
it.each(['missing', 'invalid', 'revoked', 'role', 'remote'])(
  'rejects %s identity',
  async (mode) => {
    const user = record();
    if (mode === 'revoked') user.revoked = true;
    if (mode === 'role') user.roles = [];
    await writeFile(file, JSON.stringify({ version: 1, identities: [user] }));
    const auth = new LocalQcIdentity(() => file);
    await expect(
      auth.authenticate(
        mode === 'missing'
          ? undefined
          : 'Bearer reviewer_001.' +
              (mode === 'invalid'
                ? randomBytes(32).toString('base64url')
                : secret),
        mode === 'remote' ? '192.0.2.10' : '127.0.0.1',
      ),
    ).rejects.toThrow();
  },
);
it('limits repeated failures without exposing credentials', async () => {
  const auth = new LocalQcIdentity(() => file);
  for (let i = 0; i < 5; i++)
    await expect(auth.authenticate('bad', '127.0.0.1')).rejects.toThrow(
      'QC_AUTHENTICATION_REQUIRED',
    );
  await expect(
    auth.authenticate('Bearer reviewer_001.' + secret, '127.0.0.1'),
  ).rejects.toThrow('QC_AUTH_RATE_LIMIT');
});
it('rechecks revocation for an already authenticated principal', async () => {
  const auth = new LocalQcIdentity(() => file);
  const principal = await auth.authenticate(
    'Bearer reviewer_001.' + secret,
    '::1',
  );
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      identities: [{ ...record(), revoked: true }],
    }),
  );
  expect(() => auth.assertActive(principal)).toThrow();
});

it('derives final approval actor only from the server principal', async () => {
  const { serverApprovalRequest } = await import('./local-qc-identity.js');
  vi.stubEnv('QC_IDENTITIES_FILE', file);
  try {
    const principal = await new LocalQcIdentity(() => file).authenticate(
      'Bearer reviewer_001.' + secret,
      '127.0.0.1',
    );
    expect(
      serverApprovalRequest({ decision: 'REJECTED' }, principal).actor,
    ).toBe('reviewer_001');
    expect(() =>
      serverApprovalRequest({ actor: 'client_actor' }, principal),
    ).toThrow('QC_CLIENT_ACTOR_FORBIDDEN');
    expect(() => serverApprovalRequest({}, { id: 'reviewer_001' })).toThrow(
      'QC_AUTHENTICATION_REQUIRED',
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
