import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("CLI bloqueia seleção global antes de criar ou consultar catálogo", () => {
  withDatabase((database) => {
    const result = run(["select", "--database", database, "--candidate", "candidate-1"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /LEGACY_GLOBAL_SELECTION_DISABLED/);
    assert.equal(existsSync(database), false);
  });
});

test("CLI rejeita latest e shortlist sem contratos exatos antes de abrir o banco", () => {
  withDatabase((database) => {
    const latest = run(["latest", "--database", database]);
    assert.notEqual(latest.status, 0);
    assert.match(latest.stderr, /Comando inválido/);
    assert.equal(existsSync(database), false);
    const shortlist = run(["shortlist", "--database", database]);
    assert.notEqual(shortlist.status, 0);
    assert.match(shortlist.stderr, /--input e --catalog/);
    assert.equal(existsSync(database), false);
  });
});

function run(args) {
  return spawnSync(process.execPath, [resolve("src/trend-cli.js"), ...args], { cwd: resolve("."), encoding: "utf8" });
}

function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "mktauto-shortlist-cli-"));
  try { callback(join(directory, "catalog.sqlite")); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}
