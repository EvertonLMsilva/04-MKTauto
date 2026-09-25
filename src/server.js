import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { loadConfig } from "./config.js";
import { runFixture, runLive } from "./discovery.js";
import { RunStore } from "./store.js";

const publicDir = new URL("../public/", import.meta.url);
const config = await loadConfig();
const store = new RunStore();
const port = Number(process.env.PORT || 3000);

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/health") {
      return json(response, 200, { ok: true, liveReady: Boolean(process.env.OPENAI_API_KEY && process.env.YOUTUBE_API_KEY) });
    }
    if (request.method === "GET" && request.url === "/api/config") {
      return json(response, 200, config);
    }
    if (request.method === "GET" && request.url === "/api/runs/latest") {
      return json(response, 200, store.latest());
    }
    if (request.method === "POST" && request.url === "/api/runs/fixture") {
      return json(response, 201, await runFixture({ config, store }));
    }
    if (request.method === "POST" && request.url === "/api/runs/live") {
      return json(response, 201, await runLive({ config, store }));
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
  const requested = urlPath === "/" ? "index.html" : normalize(urlPath).replace(/^[/\\]+/, "");
  if (requested.includes("..")) return json(response, 400, { error: "Caminho inválido" });
  try {
    const content = await readFile(new URL(requested, publicDir));
    response.writeHead(200, { "Content-Type": mime(extname(requested)) });
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
    store.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
