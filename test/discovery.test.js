import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { runFixture } from "../src/discovery.js";
import { RunStore } from "../src/store.js";

test("rodada 1 produz 20 candidatos e o top 5 esperado", async (context) => {
  const store = new RunStore(":memory:");
  context.after(() => store.close());
  const run = await runFixture({ config: await loadConfig(), store });

  assert.equal(run.scored.length, 20);
  assert.deepEqual(run.top.map((item) => item.name), [
    "Motos utilitárias e lançamentos",
    "Seguros e proteção do consumidor",
    "Xbox, Game Pass e lançamentos",
    "Impostos e reforma tributária",
    "Clima extremo e alertas explicados",
  ]);
  assert.equal(store.latest().id, run.id);
  assert.equal(store.get(run.id).id, run.id);
  const reviewed = store.reviewCandidate(run.id, run.top[0].id, "approved");
  assert.equal(reviewed.top[0].reviewDecision, "approved");
});
