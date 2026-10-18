import { instagramAccountId } from '../infrastructure/instagram-environment.js';
// Facebook Login only, matching InstagramGraphAdapter. No publishing capability,
// persistence or automatic probes: credentials remain private and checks use GET.
const requiredPermissions = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_read_engagement',
];
const id = (value: string | undefined) => /^[1-9]\d{4,63}$/.test(value ?? '');
const secret = (value: string | undefined) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 8192 &&
  !/\s/.test(value);

export class InstagramConnectionService {
  #env: NodeJS.ProcessEnv;
  #fetch: typeof globalThis.fetch;
  #now: () => string;
  constructor(
    env: NodeJS.ProcessEnv,
    fetch: typeof globalThis.fetch,
    now = () => new Date().toISOString(),
  ) {
    this.#env = { ...env, INSTAGRAM_ACCOUNT_ID: instagramAccountId(env) };
    this.#fetch = fetch;
    this.#now = now;
  }
  status() {
    const env = this.#env;
    const missingConfiguration = [
      ...[
        'INSTAGRAM_ACCOUNT_ID',
        'INSTAGRAM_FACEBOOK_PAGE_ID',
        'INSTAGRAM_META_APP_ID',
      ].filter((key) => !id(env[key])),
      ...(!/^v\d{2}\.0$/.test(env.INSTAGRAM_API_VERSION ?? '')
        ? ['INSTAGRAM_API_VERSION']
        : []),
      ...['INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_APP_ACCESS_TOKEN'].filter(
        (key) => !secret(env[key]),
      ),
    ];
    return {
      login: 'FACEBOOK_LOGIN' as const,
      connection: missingConfiguration.length
        ? 'NOT_CONFIGURED'
        : 'NOT_CHECKED',
      checkedAt: null as string | null,
      requiredPermissions: [...requiredPermissions],
      missingPermissions: null as string[] | null,
      missingConfiguration,
      token: { status: 'NOT_CHECKED', expiresAt: null as string | null },
      professionalAccount: false,
      blockers: missingConfiguration.length
        ? ['CONFIGURATION_REQUIRED']
        : ['CONNECTION_CHECK_REQUIRED'],
      livePublication: {
        eligible: false,
        blockedReasons: [
          'NO_PUBLISH',
          'TRUSTED_LIVE_MEDIA_REQUIRED',
          'EXACT_PUBLICATION_AUTHORIZATION_REQUIRED',
          'META_APP_ACCESS_REVIEW_NOT_VERIFIED',
        ],
      },
    };
  }
  async check() {
    const result = this.status();
    if (result.missingConfiguration.length) return result;
    const env = this.#env;
    result.checkedAt = this.#now();
    const blocked = (code: string) => {
      result.connection = 'BLOCKED';
      result.blockers = [code];
      return result;
    };
    try {
      // Meta requires input_token on the debugger URL. This URL, headers, raw
      // responses and transport exceptions must never be returned or logged.
      const debug = await this.read(
        'debug_token',
        {
          input_token: env.INSTAGRAM_ACCESS_TOKEN!,
        },
        env.INSTAGRAM_APP_ACCESS_TOKEN!,
      );
      const data = debug?.data;
      if (data?.is_valid !== true) {
        result.token.status = 'INVALID';
        return blocked('TOKEN_INVALID');
      }
      if (data.app_id !== env.INSTAGRAM_META_APP_ID)
        return blocked('TOKEN_APP_MISMATCH');
      if (data.type !== 'PAGE') return blocked('PAGE_TOKEN_REQUIRED');
      if (
        !Number.isSafeInteger(data.expires_at) ||
        data.expires_at < 0 ||
        (data.data_access_expires_at !== undefined &&
          (!Number.isSafeInteger(data.data_access_expires_at) ||
            data.data_access_expires_at < 0)) ||
        !Array.isArray(data.scopes) ||
        !data.scopes.every((value: unknown) => typeof value === 'string')
      )
        return blocked('TOKEN_RESPONSE_INVALID');
      const seconds = Date.parse(result.checkedAt!) / 1000;
      if (
        [data.expires_at, data.data_access_expires_at].some(
          (value) => value > 0 && value <= seconds,
        )
      ) {
        result.token.status = 'EXPIRED';
        return blocked('TOKEN_EXPIRED');
      }
      const expiries = [data.expires_at, data.data_access_expires_at].filter(
        (value) => value > 0,
      );
      if (expiries.length) {
        const expiry = new Date(Math.min(...expiries) * 1000);
        if (!Number.isFinite(expiry.getTime()))
          return blocked('TOKEN_RESPONSE_INVALID');
        result.token.expiresAt = expiry.toISOString();
      }
      result.token.status = 'VALID';
      const unavailableTargets = new Set<string>();
      if (data.granular_scopes !== undefined) {
        if (!Array.isArray(data.granular_scopes))
          return blocked('TOKEN_RESPONSE_INVALID');
        for (const scope of data.granular_scopes) {
          if (
            !scope ||
            typeof scope.scope !== 'string' ||
            (scope.target_ids !== undefined &&
              (!Array.isArray(scope.target_ids) ||
                !scope.target_ids.every(
                  (value: unknown) => typeof value === 'string',
                )))
          )
            return blocked('TOKEN_RESPONSE_INVALID');
          if (
            requiredPermissions.includes(scope.scope) &&
            scope.target_ids &&
            !scope.target_ids.some((target: string) =>
              [
                env.INSTAGRAM_ACCOUNT_ID,
                env.INSTAGRAM_FACEBOOK_PAGE_ID,
              ].includes(target),
            )
          )
            unavailableTargets.add(scope.scope);
        }
      }
      result.missingPermissions = requiredPermissions.filter(
        (scope) =>
          !data.scopes.includes(scope) || unavailableTargets.has(scope),
      );
      if (result.missingPermissions.length)
        return blocked(
          unavailableTargets.size
            ? 'TOKEN_TARGET_MISMATCH'
            : 'META_PERMISSION_REQUIRED',
        );
      const page = await this.read(
        'me',
        { fields: 'id,instagram_business_account' },
        env.INSTAGRAM_ACCESS_TOKEN!,
      );
      if (page?.id !== env.INSTAGRAM_FACEBOOK_PAGE_ID)
        return blocked('PAGE_TOKEN_MISMATCH');
      if (!page.instagram_business_account?.id)
        return blocked('PROFESSIONAL_ACCOUNT_LINK_REQUIRED');
      if (page.instagram_business_account.id !== env.INSTAGRAM_ACCOUNT_ID)
        return blocked('INSTAGRAM_ACCOUNT_MISMATCH');
      const account = await this.read(
        env.INSTAGRAM_ACCOUNT_ID!,
        { fields: 'id' },
        env.INSTAGRAM_ACCESS_TOKEN!,
      );
      if (account?.id !== env.INSTAGRAM_ACCOUNT_ID)
        return blocked('INSTAGRAM_ACCOUNT_MISMATCH');
      // Facebook Login exposes professional accounts through this Page edge;
      // account_type belongs to the separate Instagram Login API schema.
      result.professionalAccount = true;
      result.connection = 'READY';
      result.blockers = [];
      return result;
    } catch (error) {
      // Only codes created in read() can escape the provider boundary.
      const code =
        error instanceof ConnectionFailure ? error.code : 'META_UNAVAILABLE';
      result.connection = [
        'TOKEN_INVALID',
        'APP_AUTH_REQUIRED',
        'META_PERMISSION_REQUIRED',
      ].includes(code)
        ? 'BLOCKED'
        : 'UNAVAILABLE';
      result.blockers = [code];
      if (code === 'TOKEN_INVALID') result.token.status = 'INVALID';
      return result;
    }
  }
  private async read(
    path: string,
    fields: Record<string, string>,
    token: string,
  ) {
    const url = new URL(
      `https://graph.facebook.com/${this.#env.INSTAGRAM_API_VERSION}/${path}`,
    );
    url.search = new URLSearchParams(fields).toString();
    const response = await this.#fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok || data?.error) {
      const code = Number(data?.error?.code);
      throw new ConnectionFailure(
        response.status === 401 || code === 190
          ? path === 'debug_token'
            ? 'APP_AUTH_REQUIRED'
            : 'TOKEN_INVALID'
          : response.status === 429 || [4, 17, 32, 613, 80002].includes(code)
            ? 'META_RATE_LIMIT'
            : response.status === 403 || [10, 200].includes(code)
              ? 'META_PERMISSION_REQUIRED'
              : 'META_UNAVAILABLE',
      );
    }
    return data;
  }
}
class ConnectionFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
