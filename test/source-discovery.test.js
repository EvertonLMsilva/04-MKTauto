import test from "node:test";
import assert from "node:assert/strict";
import { discoverApprovedSources } from "../src/source-discovery.js";

test("busca fontes para três aprovados diversos", async () => {
  const requestedQueries = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    requestedQueries.push(parsed.searchParams.get("gsrsearch"));
    const id = requestedQueries.length;
    return { ok: true, json: async () => ({ query: { pages: { [id]: {
      pageid: id,
      index: id,
      title: `File:Video ${id}.webm`,
      imageinfo: [{
        url: `https://upload.wikimedia.org/video-${id}.webm`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:Video_${id}.webm`,
        mime: "video/webm",
        extmetadata: { LicenseShortName: { value: "CC0" } },
      }],
    } } } }) };
  };
  let saved;
  const store = { saveSourceDiscovery: (value) => (saved = value) };
  const run = {
    id: "run-1",
    top: [],
    provisionalTop: [
      approved("1", "Música", "música"),
      approved("2", "Outra música", "música"),
      approved("3", "Motos", "automóveis"),
      approved("4", "Jogos", "jogos"),
      approved("5", "Eletrônicos", "ciência e tecnologia"),
    ],
  };

  const result = await discoverApprovedSources({
    run,
    store,
    fetchImpl,
  });

  assert.deepEqual(requestedQueries, [
    "Brazilian music filetype:video",
    "motorcycle filetype:video",
    "Minecraft filetype:video",
  ]);
  assert.equal(result.niches.length, 3);
  assert.equal(saved.runId, "run-1");
});

function approved(id, name, macroNiche) {
  return { id, name, macroNiche, reviewDecision: "approved" };
}
