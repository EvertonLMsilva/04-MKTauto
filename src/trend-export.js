import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { serializePublicTrendCatalog } from "./domain/contracts.js";

const CSV_HEADERS = Object.freeze([
  "position", "top5", "candidate_id", "state", "platform", "title", "author", "region",
  "published_at", "duration_seconds", "canonical_url", "usage_condition", "score", "confidence",
  "velocity", "engagement", "recency", "recurrence", "explanation",
]);

export function exportDailyCatalog({ store, researchDailyRunId, logicalDate, outputRoot = "data/trends", fileSystem = defaultFileSystem() }) {
  const researchMode = typeof researchDailyRunId === "string";
  const daily = researchMode ? store.getResearchDailyRun(researchDailyRunId) : store.getDailyRun(logicalDate);
  if (!daily?.trendRunId) throw new Error(researchMode
    ? `Execução de Research não consolidada: ${researchDailyRunId}`
    : `Execução diária não consolidada: ${logicalDate}`);
  const artifact = researchMode ? store.getResearchArtifact(researchDailyRunId) : undefined;
  if (researchMode && !artifact) throw new Error(`Artefato de Research não encontrado: ${researchDailyRunId}`);
  const stored = store.getRun(daily.trendRunId);
  if (!stored) throw new Error(`Catálogo não encontrado: ${daily.trendRunId}`);
  const publicCatalog = serializePublicTrendCatalog(stored);
  const rankedIds = daily.result?.rankedCandidateIds ?? [];
  const topIds = new Set(daily.result?.topCandidateIds ?? []);
  const scoreByCandidate = new Map(publicCatalog.scores.map((score) => [score.candidateId, score]));
  const candidatesById = new Map(publicCatalog.candidates.map((candidate) => [candidate.id, candidate]));
  const ranking = rankedIds.map((candidateId, index) => {
    const candidate = candidatesById.get(candidateId);
    const score = scoreByCandidate.get(candidateId);
    if (!candidate || !score) throw new Error(`Ranking inconsistente para ${candidateId}`);
    return publicRankingItem(candidate, score, index + 1, topIds.has(candidateId));
  });
  const output = {
    ...publicCatalog,
    ...(artifact ? { researchArtifact: artifact } : {}),
    dailyRun: {
      logicalDate: daily.logicalDate,
      timezone: daily.timezone,
      state: daily.state,
      startedAt: daily.startedAt,
      completedAt: daily.completedAt,
      durationMs: daily.durationMs,
      gaps: daily.result?.gaps ?? [],
    },
    ranking,
    selectionAudit: researchMode ? [] : store.getCandidateStateEvents(logicalDate),
  };

  const target = researchMode
    ? resolve(outputRoot, daily.projectId, `v${daily.projectVersion}`, daily.logicalDate, daily.pipelineRunId)
    : resolve(outputRoot, daily.logicalDate);
  const temporary = `${target}.tmp-${process.pid}`;
  const backup = `${target}.bak-${process.pid}`;
  assertScopedDirectory(target, resolve(outputRoot));
  fileSystem.rm(temporary);
  fileSystem.rm(backup);
  try {
    fileSystem.mkdir(temporary);
    fileSystem.write(join(temporary, "catalog.json"), `${JSON.stringify(output, null, 2)}\n`);
    fileSystem.write(join(temporary, "ranking.csv"), renderCsv(ranking));
    fileSystem.write(join(temporary, "report.html"), renderHtml(output));
    for (const candidate of publicCatalog.candidates) {
      const item = ranking.find((ranked) => ranked.candidate.id === candidate.id) ?? { candidate, ranking: null };
      const directory = join(temporary, "candidates", encodeURIComponent(candidate.id));
      fileSystem.mkdir(directory);
      fileSystem.write(join(directory, "candidate.json"), `${JSON.stringify(item, null, 2)}\n`);
    }
    if (fileSystem.exists(target)) fileSystem.rename(target, backup);
    fileSystem.rename(temporary, target);
    fileSystem.rm(backup);
  } catch (error) {
    if (!fileSystem.exists(target) && fileSystem.exists(backup)) fileSystem.rename(backup, target);
    fileSystem.rm(temporary);
    throw error;
  }
  return { directory: target, files: ["catalog.json", "ranking.csv", "report.html"], candidateCount: publicCatalog.candidates.length };
}

function publicRankingItem(candidate, score, position, top5) {
  return {
    position,
    top5,
    candidate,
    score: {
      value: score.value,
      confidence: score.confidence,
      components: score.components,
      explanation: score.explanation,
    },
  };
}

function renderCsv(ranking) {
  const rows = ranking.map(({ position, top5, candidate, score }) => [
    position, top5, candidate.id, candidate.state, candidate.platform, candidate.title ?? "",
    candidate.author ?? "", candidate.region ?? "", candidate.publishedAt, formatDuration(candidate.durationSeconds),
    candidate.canonicalUrl, candidate.usageCondition, score.value, score.confidence,
    componentCell(score.components.velocity), componentCell(score.components.engagement),
    componentCell(score.components.recency), componentCell(score.components.recurrence), score.explanation,
  ]);
  return `\uFEFF${[CSV_HEADERS, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function componentCell(value) {
  return value.availability === "AVAILABLE" ? String(value.value) : `UNAVAILABLE:${value.reason}`;
}

function csvCell(value) {
  let text = String(value ?? "").replaceAll("\0", "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function renderHtml(output) {
  const latestSnapshots = latestSnapshotsByCandidate(output.snapshots ?? []);
  const rows = output.ranking.map(({ position, top5, candidate, score }) => `<tr>
<td>${position}</td><td>${top5 ? "sim" : "não"}</td><td>${escapeHtml(candidate.platform)}</td>
<td>${escapeHtml(candidate.title ?? "Título indisponível")}</td><td>${escapeHtml(candidate.state)}</td>
<td>${escapeHtml(formatViews(latestSnapshots.get(candidate.id)))}</td><td>${escapeHtml(formatPublishedDay(candidate.publishedAt))}</td>
<td>${score.value.toFixed(2)}</td><td>${Math.round(score.confidence * 100)}%</td>
<td><a href="${escapeAttribute(candidate.canonicalUrl)}">abrir fonte oficial</a></td></tr>`).join("\n");
  const rankedCandidateIds = new Set(output.ranking.map(({ candidate }) => candidate.id));
  const unranked = (output.candidates ?? []).filter(({ id }) => !rankedCandidateIds.has(id));
  const unrankedRows = unranked.map((candidate) => `<tr>
<td>${escapeHtml(candidate.platform)}</td><td>${escapeHtml(candidate.title ?? "Título indisponível")}</td>
<td>${escapeHtml(candidate.state)}</td><td>${escapeHtml(formatViews(latestSnapshots.get(candidate.id)))}</td>
<td>${escapeHtml(formatPublishedDay(candidate.publishedAt))}</td><td>${escapeHtml(unrankedReason(candidate))}</td>
<td><a href="${escapeAttribute(candidate.canonicalUrl)}">abrir fonte oficial</a></td></tr>`).join("\n");
  const unrankedSection = unranked.length === 0 ? "" : `<h2>Candidatos sem ranking</h2>
<p>Estes candidatos foram coletados, mas não receberam posição. O motivo aparece em cada linha.</p>
<table><thead><tr><th>Fonte</th><th>Título</th><th>Estado</th><th>Visualizações</th><th>Publicado em</th><th>Ranking</th><th>URL</th></tr></thead>
<tbody>${unrankedRows}</tbody></table>`;
  const sources = output.sourceRuns.map((source) => `<li><strong>${escapeHtml(source.platform)}</strong>: ${escapeHtml(source.status)} — ${escapeHtml(source.capabilities.discovery)}; lacunas: ${escapeHtml(source.gaps.join(", ") || "nenhuma")}</li>`).join("\n");
  const gaps = output.dailyRun.gaps.map((gap) => `<li>${escapeHtml(gap)}</li>`).join("\n") || "<li>nenhuma</li>";
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>Radar ${escapeHtml(output.dailyRun.logicalDate)}</title><style>
body{font-family:system-ui,sans-serif;margin:2rem;line-height:1.45;color:#1f2937}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d1d5db;padding:.5rem;text-align:left}th{background:#f3f4f6}code{overflow-wrap:anywhere}.gap{color:#92400e}</style></head>
<body><h1>Radar diário — ${escapeHtml(output.dailyRun.logicalDate)}</h1>
<p>Timezone: <code>${escapeHtml(output.dailyRun.timezone)}</code>. Estado: <strong>${escapeHtml(output.dailyRun.state)}</strong>. Esta seleção não concede direitos de uso.</p>
<h2>Cobertura</h2><ul>${sources}</ul><h2>Lacunas</h2><ul class="gap">${gaps}</ul>
<h2>Ranking</h2><table><thead><tr><th>#</th><th>Top 5</th><th>Fonte</th><th>Título</th><th>Estado</th><th>Visualizações</th><th>Publicado em</th><th>Score</th><th>Confiança</th><th>URL</th></tr></thead>
<tbody>${rows}</tbody></table>${unrankedSection}</body></html>\n`;
}

function latestSnapshotsByCandidate(snapshots) {
  const latest = new Map();
  for (const snapshot of snapshots) {
    const prior = latest.get(snapshot.candidateId);
    if (!prior || Date.parse(snapshot.capturedAt) > Date.parse(prior.capturedAt)) latest.set(snapshot.candidateId, snapshot);
  }
  return latest;
}

function formatViews(snapshot) {
  const metric = snapshot?.metrics?.views;
  if (metric?.availability !== "AVAILABLE") return "indisponível";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(metric.value);
}

function formatPublishedDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) return "indisponível";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function formatDuration(value) {
  if (Number.isFinite(value)) return String(value);
  if (value?.availability === "AVAILABLE" && Number.isFinite(value.value)) return String(value.value);
  return "indisponível";
}

function unrankedReason(candidate) {
  if (candidate.rankingExclusionReason) return `não elegível: ${candidate.rankingExclusionReason}`;
  const duration = candidate.durationSeconds;
  if (duration?.availability === "UNAVAILABLE") return `duração indisponível: ${duration.reason}`;
  return "score indisponível";
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("URL pública deve usar HTTPS");
  return escapeHtml(url.href);
}

function assertScopedDirectory(target, root) {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!target.startsWith(normalizedRoot) || target === root) throw new Error("Diretório de exportação fora do escopo diário");
}

function defaultFileSystem() {
  return {
    exists: (path) => existsSync(path),
    mkdir: (path) => mkdirSync(path, { recursive: true }),
    write: (path, content) => writeFileSync(path, content, "utf8"),
    rename: (from, to) => renameSync(from, to),
    rm: (path) => rmSync(path, { recursive: true, force: true }),
  };
}

export { CSV_HEADERS, renderCsv, renderHtml };
