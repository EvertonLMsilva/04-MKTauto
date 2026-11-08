import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

test('operational Compose preserves isolation, persistence and publication gates', () => {
  const config = JSON.parse(execFileSync('docker', ['compose', '-f', 'compose.live.yml', 'config', '--no-env-resolution', '--format', 'json'], { encoding: 'utf8' }));
  const service = config.services.mktauto;
  assert.equal(service.restart, 'unless-stopped');
  assert.equal(service.environment.CAMPAIGN_SCHEDULER_ENABLED, 'true');
  assert.equal(service.environment.INSTAGRAM_LIVE_POSTS_ENABLED, 'false');
  assert.equal(service.environment.TZ, 'America/Sao_Paulo');
  assert.equal(service.environment.PROJECT_API_DATABASE, '/data/live/kate-mkt-live.sqlite');
  assert(service.volumes.some(v => v.target === '/data/live' && v.type === 'bind'));
  for (const target of ['/models/kokoro', '/models/alignment'])
    assert(service.volumes.some(v => v.target === target && v.read_only));
  assert(service.ports.every(p => p.host_ip === '127.0.0.1'));
  assert(service.healthcheck.test.join(' ').includes('127.0.0.1'));
});

test('build context is allowlisted and startup uses the official bootstrap', () => {
  const ignore = readFileSync('.dockerignore', 'utf8');
  assert.equal(ignore.split(/\r?\n/)[0], '**');
  assert(!/^!.*(?:private|\.env|node_modules|outputs)/m.test(ignore));
  const dockerfile = readFileSync('Dockerfile', 'utf8');
  assert(dockerfile.includes('CMD ["node", "backend/dist/main.js"]'));
  assert(!/^COPY\s+\.\s/m.test(dockerfile));
});
