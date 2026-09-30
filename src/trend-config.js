export function configFromEnvironment(env) {
  return {
    regions: (env.TREND_REGIONS ?? "BR,US,MX,GB,ES,IN,JP,KR").split(",").map((item) => item.trim()).filter(Boolean),
    youtube: { apiKey: env.YOUTUBE_API_KEY, maxResultsPerRegion: number(env.YOUTUBE_MAX_RESULTS_PER_REGION, 50), maxPagesPerRegion: number(env.YOUTUBE_MAX_PAGES_PER_REGION, 1) },
    ollama: { model: env.OLLAMA_MODEL },
    instagram: { accessToken: env.INSTAGRAM_ACCESS_TOKEN, igUserId: env.INSTAGRAM_IG_USER_ID, apiVersion: env.INSTAGRAM_API_VERSION, eligibility: flags(env, "INSTAGRAM", ["PROFESSIONAL_ACCOUNT", "FACEBOOK_PAGE_LINKED", "PERMISSIONS_GRANTED", "APP_ACCESS_APPROVED"]) },
    threads: { accessToken: env.THREADS_ACCESS_TOKEN, apiVersion: env.THREADS_API_VERSION ?? "v1.0", searchType: env.THREADS_SEARCH_TYPE ?? "TOP", eligibility: flags(env, "THREADS", ["BASIC_GRANTED", "KEYWORD_SEARCH_GRANTED", "APP_ACCESS_APPROVED"]) },
    tiktok: { product: env.TIKTOK_PRODUCT ?? "RESEARCH_API", accessToken: env.TIKTOK_ACCESS_TOKEN, authorizedAccountContext: env.TIKTOK_AUTHORIZED_ACCOUNT_CONTEXT, eligibility: flags(env, "TIKTOK_RESEARCH", ["ELIGIBLE_ORGANIZATION", "NON_COMMERCIAL_RESEARCH", "ETHICAL_REVIEW_APPROVED", "RESEARCH_PROJECT_APPROVED", "RESEARCH_SCOPE_GRANTED", "RETENTION_CONTROLS_APPROVED"]), displayAccess: flags(env, "TIKTOK_DISPLAY", ["ACCOUNT_AUTHORIZED", "APP_APPROVED", "VIDEO_LIST_SCOPE_GRANTED"]) },
  };
}
function flags(env, prefix, names) { return Object.fromEntries(names.map((name) => [camel(name), env[`${prefix}_${name}`] === "true"])); }
function camel(value) { return value.toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()); }
function number(value, fallback) { if (value === undefined || value === "") return fallback; const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Valor numérico inválido: ${value}`); return parsed; }
