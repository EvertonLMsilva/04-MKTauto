import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("console web contém bootstrap, seleção de ideia, preview, QC e decisão humana explícita", () => {
  const html = readFileSync(new URL("../public/preview.html", import.meta.url), "utf8");
  const client = readFileSync(new URL("../public/preview.js", import.meta.url), "utf8");
  for (const id of ["project", "version", "run", "selection", "new-run", "idea-candidates", "idea-actor", "idea-rationale", "select-idea", "video", "findings", "approval-actor", "approval-justification", "approve", "reject", "approval-history"]) assert.match(html, new RegExp(`id="${id}"`));
  for (const stage of ["Script", "Voice", "Media", "Composition", "Subtitles", "Preview", "QC"]) assert.match(html, new RegExp(`>${stage}<`));
  assert.match(html, /Aprovar versão exata/);
  assert.match(html, /Rejeitar versão exata/);
  assert.match(client, /\/api\/operator-preview\/approvals/);
  assert.match(client, /\/api\/operator-preview\/runs/);
  assert.match(client, /\/api\/operator-preview\/idea-selections/);
  assert.match(client, /qualityControlReportContentHash/);
  assert.match(client, /if \(completeScope\(\) && view\.active\) refreshTimer/);
  assert.match(client, /Falha IDEA_RESEARCH_EMPTY/);
  assert.doesNotMatch(client, /Retomar execução/);
});
