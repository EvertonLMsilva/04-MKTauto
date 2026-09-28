import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = [
  "../src/domain/composition-plan-contracts.js",
  "../src/composition-plan-service.js",
  "../src/composition-plan-repository.js",
];

test("domínio e aplicação de composição independem de composer, SDK e fornecedor", () => {
  for (const file of FILES) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:ffmpeg|openai|google|azure|aws|cloudinary|pexels|unsplash)[^"']*["']/i);
  }
});

test("serviço usa apenas identidades explícitas e não oferece latest", async () => {
  const { CompositionPlanService } = await import("../src/composition-plan-service.js");
  const calls = [];
  const service = new CompositionPlanService({
    registerCompositionPlan: (value) => (calls.push(["register", value]), value),
    getCompositionPlan: (id) => (calls.push(["get", id]), null),
    listCompositionPlansByPipelineRun: (id) => (calls.push(["run", id]), []),
    listCompositionPlansByScript: (id) => (calls.push(["script", id]), []),
  });
  service.register({ compositionPlanId: "composition_plan_001" });
  service.get("composition_plan_001");
  service.listByPipelineRun("run_e07_001");
  service.listByScript("script_001");
  assert.deepEqual(calls, [
    ["register", { compositionPlanId: "composition_plan_001" }],
    ["get", "composition_plan_001"], ["run", "run_e07_001"], ["script", "script_001"],
  ]);
  assert.equal("latest" in service, false);
});
