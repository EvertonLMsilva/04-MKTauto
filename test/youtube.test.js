import test from "node:test";
import assert from "node:assert/strict";
import { fetchPopularYouTubeSignals } from "../src/adapters/youtube.js";

test("coleta categorias oficiais e remove vídeos duplicados", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(new URL(url));
    const category = new URL(url).searchParams.get("videoCategoryId") ?? "geral";
    return {
      ok: true,
      json: async () => ({ items: [
        item("compartilhado", "Compartilhado"),
        item(category, `Categoria ${category}`),
      ] }),
    };
  };

  const result = await fetchPopularYouTubeSignals({
    apiKey: "teste",
    regionCode: "BR",
    maxResults: 10,
    categoryIds: [null, "20", "27"],
    fetchImpl,
  });

  assert.equal(urls.length, 3);
  assert.equal(urls[0].searchParams.has("videoCategoryId"), false);
  assert.equal(urls[1].searchParams.get("videoCategoryId"), "20");
  assert.equal(result.length, 4);
  assert.equal(result.filter((signal) => signal.id === "youtube:compartilhado").length, 1);
  assert.equal(result.find((signal) => signal.id === "youtube:20").sourceCategory, "jogos");
});

test("ignora categoria sem chart disponível na região", async () => {
  const fetchImpl = async (url) => {
    const category = new URL(url).searchParams.get("videoCategoryId");
    if (category === "27") return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => ({ items: [item("geral", "Geral")] }) };
  };

  const result = await fetchPopularYouTubeSignals({
    apiKey: "teste",
    regionCode: "BR",
    maxResults: 10,
    categoryIds: [null, "27"],
    fetchImpl,
  });

  assert.equal(result.length, 1);
});

function item(id, title) {
  return {
    id,
    snippet: { title, channelId: "canal", channelTitle: "Canal", categoryId: id, tags: [] },
    statistics: { viewCount: "10", likeCount: "2", commentCount: "1" },
  };
}
