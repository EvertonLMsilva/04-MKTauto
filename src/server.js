import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { loadConfig } from "./config.js";
import { runFixture, runLive } from "./discovery.js";
import { discoverApprovedSources } from "./source-discovery.js";
import { RunStore } from "./store.js";
import { OperatorPreviewConsole } from "./operator-preview-console.js";
import { handleOperatorPreviewRequest } from "./operator-preview-http.js";

const publicDir = new URL("../public/", import.meta.url);
const config = await loadConfig();
const store = new RunStore();
const operatorPreview = new OperatorPreviewConsole();
const port = Number(process.env.PORT || 3000);

const server = createServer(async (request, response) => {
  try {
    if (await handleOperatorPreviewRequest(request, response, operatorPreview)) return;
    if (request.method === "GET" && request.url === "/api/health") {
      return json(response, 200, {
        ok: true,
        liveReady: Boolean(process.env.YOUTUBE_API_KEY),
        aiProvider: "ollama",
      });
    }
    if (request.method === "GET" && request.url === "/api/config") {
      return json(response, 200, config);
    }
    if (request.method === "GET" && request.url === "/api/runs/latest") {
      return json(response, 200, store.latest());
    }
    const runMatch = request.url.match(/^\/api\/runs\/([^/?]+)$/);
    if (request.method === "GET" && runMatch) {
      const run = store.get(decodeURIComponent(runMatch[1]));
      return run ? json(response, 200, run) : json(response, 404, { error: "Rodada não encontrada" });
    }
    if (request.method === "POST" && request.url === "/api/runs/fixture") {
      return json(response, 201, await runFixture({ config, store }));
    }
    if (request.method === "POST" && request.url === "/api/runs/live") {
      return json(response, 201, await runLive({ config, store }));
    }
    const sourceDiscoveryMatch = request.url.match(/^\/api\/runs\/([^/]+)\/sources\/discover$/);
    if (request.method === "POST" && sourceDiscoveryMatch) {
      const run = store.get(sourceDiscoveryMatch[1]);
      if (!run) return json(response, 404, { error: "Rodada não encontrada" });
      return json(response, 201, await discoverApprovedSources({
        run,
        store,
      }));
    }
    const latestSourcesMatch = request.url.match(/^\/api\/runs\/([^/]+)\/sources\/latest$/);
    if (request.method === "GET" && latestSourcesMatch) {
      return json(response, 200, store.latestSourceDiscovery(latestSourcesMatch[1]));
    }
    const sourceReviewMatch = request.url.match(/^\/api\/source-runs\/([^/]+)\/sources\/([^/]+)\/review$/);
    if (request.method === "PATCH" && sourceReviewMatch) {
      const body = await readJson(request);
      return json(response, 200, store.reviewSource(
        sourceReviewMatch[1],
        decodeURIComponent(sourceReviewMatch[2]),
        body.decision,
      ));
    }
    const reviewMatch = request.url.match(/^\/api\/runs\/([^/]+)\/candidates\/([^/]+)\/review$/);
    if (request.method === "PATCH" && reviewMatch) {
      const body = await readJson(request);
      return json(response, 200, store.reviewCandidate(reviewMatch[1], reviewMatch[2], body.decision));
    }
    if (request.method === "GET") return staticFile(request.url, response);
    return json(response, 404, { error: "Rota não encontrada" });
  } catch (error) {
    return json(response, 400, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`MKTauto discovery em http://localhost:${port}`);
});

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function staticFile(urlPath, response) {
  const pathname = new URL(urlPath, "http://localhost").pathname;
  const requested = pathname === "/" ? "index.html" : normalize(pathname).replace(/^[/\\]+/, "");
  if (requested.includes("..")) return json(response, 400, { error: "Caminho inválido" });
  try {
    const content = await readFile(new URL(requested, publicDir));
    response.writeHead(200, {
      "Content-Type": mime(extname(requested)),
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch {
    json(response, 404, { error: "Arquivo não encontrado" });
  }
}

function mime(extension) {
  return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" })[extension] || "application/octet-stream";
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.reduce((total, chunk) => total + chunk.length, 0) > 16_384) {
    throw new Error("Corpo da requisição excede o limite");
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function shutdown() {
  server.close(() => {
    operatorPreview.close();
    store.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
