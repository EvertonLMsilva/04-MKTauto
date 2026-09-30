import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("console web contém seleção explícita, sete etapas, vídeo, QC e aprovação indisponível", () => {
  const html = readFileSync(new URL("../public/preview.html", import.meta.url), "utf8");
  const client = readFileSync(new URL("../public/preview.js", import.meta.url), "utf8");
  for (const id of ["project", "version", "run", "selection", "video", "findings"]) assert.match(html, new RegExp(`id="${id}"`));
  for (const stage of ["Script", "Voice", "Media", "Composition", "Subtitles", "Preview", "QC"]) assert.match(html, new RegExp(`>${stage}<`));
  assert.match(html, /Aprovação indisponível neste tópico/);
  assert.doesNotMatch(client, /\/approvals|approve|reject/i);
});
