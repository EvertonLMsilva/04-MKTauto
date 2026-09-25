import { readFile } from "node:fs/promises";

const configUrl = new URL("../config/discovery.json", import.meta.url);

export async function loadConfig() {
  const config = JSON.parse(await readFile(configUrl, "utf8"));
  validateWeights(config.trendWeights, "trendWeights");
  validateWeights(config.viabilityWeights, "viabilityWeights");
  validateWeights(config.finalWeights, "finalWeights");
  return config;
}

function validateWeights(weights, name) {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.00001) {
    throw new Error(`${name} deve somar 1; total recebido: ${total}`);
  }
}

