// Preserve the explicit canonical destination. Legacy aliases may identify the
// same Instagram account, but disagreement must never silently choose a target.
export function instagramAccountId(env: NodeJS.ProcessEnv): string {
  if (env.INSTAGRAM_ACCOUNT_ID) return env.INSTAGRAM_ACCOUNT_ID;
  const aliases = [env.INSTAGRAM_IG_USER_ID, env.INSTAGRAM_USER_ID].filter(
    (value): value is string => Boolean(value),
  );
  return new Set(aliases).size === 1 ? aliases[0]! : '';
}
