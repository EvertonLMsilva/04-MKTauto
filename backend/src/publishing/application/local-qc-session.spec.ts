import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { LocalQcIdentity } from './local-qc-identity.js';
import { LocalQcSessions } from './local-qc-session.js';

test('browser sessions require the existing reviewer, origin and CSRF; expire and honor revocation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qc-browser-'));
  try {
    const secret = randomBytes(32).toString('base64url'),
      salt = randomBytes(16).toString('hex');
    const user = {
      id: 'operator_001',
      salt,
      hash: scryptSync(secret, Buffer.from(salt, 'hex'), 64, {
        N: 32768,
        r: 8,
        p: 1,
        maxmem: 67108864,
      }).toString('hex'),
      roles: ['QC_REVIEWER'],
      revoked: false,
    };
    const file = join(root, 'identities.json');
    const save = () =>
      writeFile(file, JSON.stringify({ version: 1, identities: [user] }), {
        mode: 0o600,
      });
    await save();
    let now = 1000;
    const sessions = new LocalQcSessions(
      new LocalQcIdentity(() => file),
      () => now,
    );
    const request = (method = 'POST') => ({
      method,
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
      } as Record<string, string>,
      socket: { remoteAddress: '127.0.0.1' },
    });
    const req = request();
    const session = await sessions.login({ operatorId: user.id, secret }, req);
    expect(session.cookie).toContain('HttpOnly');
    expect(session.cookie).toContain('SameSite=Strict');
    expect(session.cookie).not.toContain(secret);
    const get = request('GET');
    get.headers.cookie = session.cookie.split(';')[0];
    expect(sessions.authenticate(get).id).toBe(user.id);
    const post = { ...get, method: 'POST' };
    expect(() => sessions.authenticate(post)).toThrow('QC_CSRF_REQUIRED');
    post.headers['x-qc-csrf'] = 'é'.repeat(43);
    expect(() => sessions.authenticate(post)).toThrow('QC_CSRF_REQUIRED');
    post.headers['x-qc-csrf'] = session.csrfToken;
    expect(sessions.authenticate(post).id).toBe(user.id);
    post.headers.origin = 'https://attacker.example';
    expect(() => sessions.authenticate(post)).toThrow('QC_ORIGIN_REQUIRED');
    post.headers.origin = 'http://localhost:3000';
    user.revoked = true;
    await save();
    expect(() => sessions.authenticate(get)).toThrow('QC_REVIEWER_REQUIRED');
    user.revoked = false;
    await save();
    now += 31 * 60 * 1000;
    expect(() => sessions.authenticate(get)).toThrow('QC_SESSION_EXPIRED');
    expect(() =>
      sessions.authenticate({
        ...get,
        socket: { remoteAddress: '192.168.1.4' },
      }),
    ).toThrow('QC_LOCAL_ACCESS_REQUIRED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
