import test from "node:test";
import assert from "node:assert/strict";
import { analyzeInstagramReference } from "../src/adapters/instagram.js";
import { analyzeThreadsReference } from "../src/adapters/threads.js";
import { analyzeTikTokReference } from "../src/adapters/tiktok.js";
import { analyzeYouTubeReference } from "../src/adapters/youtube.js";

test("YouTube resolve somente o handle configurado e lista uploads públicos", async () => {
  const urls = [];
  const result = await analyzeYouTubeReference({
    handle: "@CanalOficial",
    apiKey: "segredo",
    fetchImpl: async (input) => {
      const url = new URL(input);
      urls.push(url);
      if (url.pathname.endsWith("/channels")) return response({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UU123" } } }] });
      if (url.pathname.endsWith("/playlistItems")) return response({ items: [{ contentDetails: { videoId: "video-1" } }] });
      return response({ items: [{
        id: "video-1",
        snippet: { publishedAt: "2026-09-26T12:00:00Z", title: "Como produzir", description: "siga", tags: ["produtividade"] },
        contentDetails: { duration: "PT45S" }, statistics: { viewCount: "10" },
      }] });
    },
  });
  assert.equal(urls[0].searchParams.get("forHandle"), "CanalOficial");
  assert.equal(urls.some((url) => url.searchParams.has("chart")), false);
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.items[0].sourceText.includes("Como produzir"), true);
});

test("Instagram usa Business Discovery exato e não solicita URL de mídia", async () => {
  let requested;
  const result = await analyzeInstagramReference({
    handle: "@perfil.a", accessToken: "segredo", igUserId: "1234567890", apiVersion: "v24.0",
    eligibility: {
      professionalAccount: true, facebookPageLinked: true, permissionsGranted: true,
      appAccessApproved: true, businessDiscoveryGranted: true,
    },
    fetchImpl: async (input) => {
      requested = new URL(input);
      return response({ business_discovery: { media: { data: [{
        id: "12345678901", caption: "Comente aqui", media_type: "VIDEO", media_product_type: "REELS",
        permalink: "https://www.instagram.com/reel/abc123/", timestamp: "2026-09-26T12:00:00Z",
      }] } } });
    },
  });
  const fields = requested.searchParams.get("fields");
  assert.match(fields, /^business_discovery\.username\(perfil\.a\)/);
  assert.equal(fields.includes("media_url"), false);
  assert.equal(result.items[0].canonicalUrl, "https://instagram.com/reel/abc123");
  assert.deepEqual(result.gaps, ["INSTAGRAM_DURATION_UNAVAILABLE"]);
});

test("Threads usa profile_posts por username, nunca keyword_search", async () => {
  let requested;
  const result = await analyzeThreadsReference({
    handle: "@perfil", accessToken: "segredo", apiVersion: "v1.0",
    eligibility: { basicGranted: true, profileDiscoveryGranted: true, appAccessApproved: true },
    fetchImpl: async (input) => {
      requested = new URL(input);
      return response({ data: [{
        id: "thread12345", media_type: "TEXT_POST", permalink: "https://www.threads.net/@perfil/post/abc123",
        timestamp: "2026-09-26T12:00:00Z", text: "Salve para depois",
      }] });
    },
  });
  assert.equal(requested.pathname, "/v1.0/profile_posts");
  assert.equal(requested.searchParams.get("username"), "perfil");
  assert.equal(requested.pathname.includes("keyword_search"), false);
  assert.equal(result.items.length, 1);
});

test("TikTok não consulta referência diferente da conta OAuth autorizada", async () => {
  let calls = 0;
  const result = await analyzeTikTokReference({
    handle: "referencia", accessToken: "segredo", authorizedAccountContext: "outra_conta",
    displayAccess: { accountAuthorized: true, appApproved: true, videoListScopeGranted: true },
    fetchImpl: async () => { calls += 1; return response({}); },
  });
  assert.equal(calls, 0);
  assert.equal(result.status, "BLOCKED_BY_PROVIDER");
  assert.deepEqual(result.gaps, ["TIKTOK_REFERENCE_ACCOUNT_NOT_AUTHORIZED"]);
});

test("erros de provider são reduzidos a códigos estáveis sem payload ou segredo", async () => {
  const result = await analyzeYouTubeReference({
    handle: "canal", apiKey: "ultrassecreto",
    fetchImpl: async () => response({ error: { message: "ultrassecreto", errors: [{ reason: "quotaExceeded" }] } }, 403),
  });
  assert.deepEqual(result, {
    capability: "PUBLIC_HANDLE_UPLOADS", status: "BLOCKED_BY_PROVIDER", items: [], gaps: ["YOUTUBE_QUOTA_EXCEEDED"],
  });
  assert.equal(JSON.stringify(result).includes("ultrassecreto"), false);
});

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
