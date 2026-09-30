import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { TrendCatalogStore } from "./trend-store.js";
import { exportDailyCatalog } from "./trend-export.js";
import { runDailyTrendCatalog } from "./trend-daily.js";
import { buildResearchShortlist } from "./research-shortlist.js";
import { configFromEnvironment } from "./trend-config.js";

const [command = "daily", ...args] = process.argv.slice(2);
const options = parseOptions(args);
const logicalDate = options.date ?? logicalDateInTimezone(new Date(), options.timezone ?? process.env.TREND_TIMEZONE ?? "America/Sao_Paulo");
const timezone = options.timezone ?? process.env.TREND_TIMEZONE ?? "America/Sao_Paulo";
const databasePath = resolve(options.database ?? process.env.TREND_DATABASE ?? "data/trends.sqlite");
const outputRoot = resolve(options.output ?? process.env.TREND_OUTPUT_ROOT ?? "data/trends");
if (!["daily", "shortlist", "select", "export"].includes(command)) {
  throw new Error("Comando inválido. Use daily, shortlist ou export.");
}
if (command === "select") throw new Error("LEGACY_GLOBAL_SELECTION_DISABLED: use shortlist com ResearchInput e ResearchTopicCatalog exatos");
if (command === "shortlist" && (!options.input || !options.catalog)) {
  throw new Error("--input e --catalog com contratos JSON exatos são obrigatórios");
}
const store = new TrendCatalogStore(databasePath);

try {
  let result;
  if (command === "daily") {
    if (!options.input) throw new Error("--input com ResearchInput JSON é obrigatório");
    const researchInput = JSON.parse(readFileSync(resolve(options.input), "utf8"));
    result = await runDailyTrendCatalog({ store, researchInput, outputRoot, config: configFromEnvironment(process.env) });
  } else if (command === "shortlist") {
    result = buildResearchShortlist({
      store,
      researchInput: JSON.parse(readFileSync(resolve(options.input), "utf8")),
      researchTopicCatalog: JSON.parse(readFileSync(resolve(options.catalog), "utf8")),
    });
  } else if (command === "export") {
    result = options["research-run"]
      ? exportDailyCatalog({ store, researchDailyRunId: options["research-run"], outputRoot })
      : exportDailyCatalog({ store, logicalDate, outputRoot });
  } else {
    throw new Error("Comando inválido. Use daily, shortlist ou export.");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  store.close();
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
