import { instagramAccountId } from './infrastructure/instagram-environment.js';
import { InstagramConnectionService } from './application/instagram-connection.service.js';

test('canonical destination wins, including invalid explicit configuration', () => {
  expect(
    instagramAccountId({
      INSTAGRAM_ACCOUNT_ID: '123456789',
      INSTAGRAM_IG_USER_ID: '234567890',
    }),
  ).toBe('123456789');
  expect(
    instagramAccountId({
      INSTAGRAM_ACCOUNT_ID: 'invalid',
      INSTAGRAM_USER_ID: '123456789',
    }),
  ).toBe('invalid');
});
test.each(['INSTAGRAM_IG_USER_ID', 'INSTAGRAM_USER_ID'])(
  'recognizes existing alias %s',
  (key) => {
    expect(instagramAccountId({ [key]: '123456789' })).toBe('123456789');
    const service = new InstagramConnectionService(
      { [key]: '123456789', INSTAGRAM_API_VERSION: 'v26.0' },
      vi.fn(),
    );
    expect(service.status().missingConfiguration).not.toContain(
      'INSTAGRAM_ACCOUNT_ID',
    );
  },
);
test('matching aliases are accepted; ambiguous aliases fail closed without choosing a destination', () => {
  expect(
    instagramAccountId({
      INSTAGRAM_IG_USER_ID: '123456789',
      INSTAGRAM_USER_ID: '123456789',
    }),
  ).toBe('123456789');
  expect(
    instagramAccountId({
      INSTAGRAM_IG_USER_ID: '123456789',
      INSTAGRAM_USER_ID: '234567890',
    }),
  ).toBe('');
  expect(instagramAccountId({})).toBe('');
});
test('declarative legacy flags never synthesize credentials, linkage or permissions', async () => {
  const fetch = vi.fn();
  const service = new InstagramConnectionService(
    {
      INSTAGRAM_USER_ID: '123456789',
      INSTAGRAM_API_VERSION: 'v26.0',
      INSTAGRAM_ACCESS_TOKEN: 'TEST_TOKEN',
      INSTAGRAM_APP_ACCESS_APPROVED: 'true',
      INSTAGRAM_FACEBOOK_PAGE_LINKED: 'true',
      INSTAGRAM_PERMISSIONS_GRANTED: 'true',
      INSTAGRAM_PROFESSIONAL_ACCOUNT: 'true',
    },
    fetch,
  );
  expect(await service.check()).toMatchObject({
    connection: 'NOT_CONFIGURED',
    missingPermissions: null,
    professionalAccount: false,
    missingConfiguration: [
      'INSTAGRAM_FACEBOOK_PAGE_ID',
      'INSTAGRAM_META_APP_ID',
      'INSTAGRAM_APP_ACCESS_TOKEN',
    ],
    livePublication: { eligible: false },
  });
  expect(fetch).not.toHaveBeenCalled();
});
