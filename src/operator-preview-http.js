import { createReadStream } from "node:fs";
import { OperatorPreviewError } from "./operator-preview-console.js";
import { PreviewExecutionError } from "./preview-execution.js";

export async function handleOperatorPreviewRequest(request, response, adapter) {
  const url = new URL(request.url, "http://localhost");
  const matched = url.pathname.startsWith("/api/operator-preview/");
  if (!matched) return false;
  try {
    if (request.method === "GET" && url.pathname === "/api/operator-preview/catalog") {
      exactQuery(url, ["projectId", "projectVersion", "pipelineRunId"]);
      return sendJson(response, 200, await adapter.catalog(Object.fromEntries(url.searchParams)));
    }
    if (request.method === "GET" && url.pathname === "/api/operator-preview/status") {
      exactQuery(url, ["projectId", "projectVersion", "pipelineRunId", "selectionId"]);
      return sendJson(response, 200, await adapter.status(Object.fromEntries(url.searchParams)));
    }
    if (request.method === "POST" && url.pathname === "/api/operator-preview/executions") {
      const scope = await readJson(request);
      await adapter.status(scope);
      adapter.start(scope);
      return sendJson(response, 202, await adapter.status(scope));
    }
    const video = /^\/api\/operator-preview\/videos\/([a-z0-9][a-z0-9_:-]{2,199})$/.exec(url.pathname);
    if (request.method === "GET" && video) {
      exactQuery(url, ["sha256"]);
      return streamVideo(request, response, await adapter.openVideo(decodeURIComponent(video[1]), url.searchParams.get("sha256")));
    }
    return false;
  } catch (caught) {
    const error = publicError(caught);
    sendJson(response, error.status, { error: { code: error.code, field: error.field, message: error.message } });
    return true;
  }
}

function streamVideo(request, response, video) {
  const range = parseRange(request.headers.range, video.size);
  const start = range?.start ?? 0; const end = range?.end ?? video.size - 1;
  response.writeHead(range ? 206 : 200, {
    "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, no-store",
    "Content-Length": end - start + 1,
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${video.size}` } : {}),
  });
  createReadStream(video.path, { start, end }).pipe(response);
  return true;
}
function parseRange(value, size) {
  if (value === undefined) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value);
  if (!match) throw new OperatorPreviewError("INVALID_RANGE", "range", "intervalo de vídeo inválido");
  const start = Number(match[1]); const end = match[2] === "" ? size - 1 : Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || end >= size) throw new OperatorPreviewError("INVALID_RANGE", "range", "intervalo de vídeo inválido");
  return { start, end };
}
function exactQuery(url, allowed) { for (const key of url.searchParams.keys()) if (!allowed.includes(key)) throw new OperatorPreviewError("UNKNOWN_QUERY", key, "parâmetro não permitido"); }
async function readJson(request) { const chunks = []; let total = 0; for await (const chunk of request) { total += chunk.length; if (total > 16_384) throw new OperatorPreviewError("BODY_TOO_LARGE", "body", "corpo excede o limite"); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw new OperatorPreviewError("INVALID_JSON", "body", "JSON inválido"); } }
function sendJson(response, status, body) { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); response.end(JSON.stringify(body)); return true; }
function publicError(caught) {
  if (caught instanceof OperatorPreviewError || caught instanceof PreviewExecutionError) return { status: statusFor(caught.code), code: caught.code, field: caught.field, message: caught.publicMessage };
  return { status: 500, code: "INTERNAL_ERROR", field: "preview", message: "a operação local não foi concluída" };
}
function statusFor(code) { if (code.endsWith("NOT_FOUND")) return 404; if (["CONSOLE_CLOSED"].includes(code)) return 503; return 400; }
