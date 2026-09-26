import { validateTrendSnapshot } from "./contracts.js";

export function calculateSnapshotVelocity(previous, current, metric = "views") {
  validateTrendSnapshot(previous);
  validateTrendSnapshot(current);
  const evidenceSnapshotIds = [previous.id, current.id];
  if (previous.candidateId !== current.candidateId) {
    return unavailable("DIFFERENT_CANDIDATES", evidenceSnapshotIds);
  }
  const elapsedHours = (Date.parse(current.capturedAt) - Date.parse(previous.capturedAt)) / 3_600_000;
  if (elapsedHours <= 0) return unavailable("NON_CHRONOLOGICAL", evidenceSnapshotIds);
  const before = previous.metrics[metric];
  const after = current.metrics[metric];
  if (!before || !after || before.availability !== "AVAILABLE" || after.availability !== "AVAILABLE") {
    return unavailable("MISSING_METRICS", evidenceSnapshotIds);
  }
  if (after.value < before.value) return unavailable("INCOMPARABLE_COUNTER", evidenceSnapshotIds);
  return {
    availability: "AVAILABLE",
    metric,
    valuePerHour: Math.round(((after.value - before.value) / elapsedHours) * 100) / 100,
    elapsedHours: Math.round(elapsedHours * 100) / 100,
    evidenceSnapshotIds,
  };
}

export function calculateHistoricalVelocity(snapshots, metric = "views") {
  const ordered = [...snapshots].sort((left, right) =>
    Date.parse(left.capturedAt) - Date.parse(right.capturedAt) || left.id.localeCompare(right.id));
  return ordered.slice(1).map((snapshot, index) => ({
    fromSnapshotId: ordered[index].id,
    toSnapshotId: snapshot.id,
    result: calculateSnapshotVelocity(ordered[index], snapshot, metric),
  }));
}

function unavailable(reason, evidenceSnapshotIds) {
  return { availability: "UNAVAILABLE", reason, evidenceSnapshotIds };
}
