import { resolve } from "node:path";
import { TrendCatalogStore } from "./trend-store.js";
import { exportDailyCatalog } from "./trend-export.js";
import { runDailyTrendCatalog } from "./trend-daily.js";

const [command = "daily", ...args] = process.argv.slice(2);
const options = parseOptions(args);
const logicalDate = options.date ?? logicalDateInTimezone(new Date(), options.timezone ?? process.env.TREND_TIMEZONE ?? "America/Sao_Paulo");
const timezone = options.timezone ?? process.env.TREND_TIMEZONE ?? "America/Sao_Paulo";
const databasePath = resolve(options.database ?? process.env.TREND_DATABASE ?? "data/trends.sqlite");
const outputRoot = resolve(options.output ?? process.env.TREND_OUTPUT_ROOT ?? "data/trends");
const store = new TrendCatalogStore(databasePath);

try {
  let result;
  if (command === "daily") {
    result = await runDailyTrendCatalog({ store, logicalDate, timezone, outputRoot, config: configFromEnvironment(process.env) });
  } else if (command === "shortlist" || command === "select") {
    const candidateId = options.candidate;
    if (!candidateId) throw new Error("--candidate é obrigatório");
    store.changeCandidateState({
      logicalDate,
      candidateId,
      nextState: command === "select" ? "SELECTED" : "SHORTLISTED",
      actor: options.actor ?? process.env.USERNAME ?? "operador",
      changedAt: new Date().toISOString(),
    });
    result = exportDailyCatalog({ store, logicalDate, outputRoot });
  } else if (command === "export") {
    result = exportDailyCatalog({ store, logicalDate, outputRoot });
  } else {
    throw new Error("Comando inválido. Use daily, shortlist, select ou export.");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  store.close();
}

function configFromEnvironment(env) {
  return {
    regions: (env.TREND_REGIONS ?? "BR,US,MX,GB,ES,IN,JP,KR").split(",").map((item) => item.trim()).filter(Boolean),
    youtube: {
      apiKey: env.YOUTUBE_API_KEY,
      maxResultsPerRegion: number(env.YOUTUBE_MAX_RESULTS_PER_REGION, 50),
      maxPagesPerRegion: number(env.YOUTUBE_MAX_PAGES_PER_REGION, 1),
    },
    ollama: { model: env.OLLAMA_MODEL },
    instagram: {
      accessToken: env.INSTAGRAM_ACCESS_TOKEN,
      igUserId: env.INSTAGRAM_IG_USER_ID,
      apiVersion: env.INSTAGRAM_API_VERSION,
      eligibility: flags(env, "INSTAGRAM", ["PROFESSIONAL_ACCOUNT", "FACEBOOK_PAGE_LINKED", "PERMISSIONS_GRANTED", "APP_ACCESS_APPROVED"]),
    },
    threads: {
      accessToken: env.THREADS_ACCESS_TOKEN,
      apiVersion: env.THREADS_API_VERSION ?? "v1.0",
      searchType: env.THREADS_SEARCH_TYPE ?? "TOP",
      eligibility: flags(env, "THREADS", ["BASIC_GRANTED", "KEYWORD_SEARCH_GRANTED", "APP_ACCESS_APPROVED"]),
    },
    tiktok: {
      product: env.TIKTOK_PRODUCT ?? "RESEARCH_API",
      accessToken: env.TIKTOK_ACCESS_TOKEN,
      authorizedAccountContext: env.TIKTOK_AUTHORIZED_ACCOUNT_CONTEXT,
      eligibility: flags(env, "TIKTOK_RESEARCH", ["ELIGIBLE_ORGANIZATION", "NON_COMMERCIAL_RESEARCH", "ETHICAL_REVIEW_APPROVED", "RESEARCH_PROJECT_APPROVED", "RESEARCH_SCOPE_GRANTED", "RETENTION_CONTROLS_APPROVED"]),
      displayAccess: flags(env, "TIKTOK_DISPLAY", ["ACCOUNT_AUTHORIZED", "APP_APPROVED", "VIDEO_LIST_SCOPE_GRANTED"]),
    },
  };
}

function flags(env, prefix, names) {
  return Object.fromEntries(names.map((name) => [camel(name), env[`${prefix}_${name}`] === "true"]));
}

function camel(value) {
  return value.toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function number(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Valor numérico inválido: ${value}`);
  return parsed;
}

function parseOptions(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    if (!name?.startsWith("--") || values[index + 1] === undefined) throw new Error(`Opção inválida: ${name ?? "ausente"}`);
    options[name.slice(2)] = values[index + 1];
  }
  return options;
}

function logicalDateInTimezone(now, timezone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export { configFromEnvironment, logicalDateInTimezone };
