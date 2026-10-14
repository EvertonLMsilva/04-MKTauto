import { validateTrendSnapshot } from './research-record-contracts.js';

export function calculateSnapshotVelocity(
  previous: any,
  current: any,
  metric: any = 'views',
): any {
  validateTrendSnapshot(previous);
  validateTrendSnapshot(current);
  const evidenceSnapshotIds: any = [previous.id, current.id];
  if (previous.candidateId !== current.candidateId) {
    return unavailable('DIFFERENT_CANDIDATES', evidenceSnapshotIds);
  }
  const elapsedHours: any =
    (Date.parse(current.capturedAt) - Date.parse(previous.capturedAt)) /
    3_600_000;
  if (elapsedHours <= 0)
    return unavailable('NON_CHRONOLOGICAL', evidenceSnapshotIds);
  const before: any = previous.metrics[metric];
  const after: any = current.metrics[metric];
  if (
    !before ||
    !after ||
    before.availability !== 'AVAILABLE' ||
    after.availability !== 'AVAILABLE'
  ) {
    return unavailable('MISSING_METRICS', evidenceSnapshotIds);
  }
  if (after.value < before.value)
    return unavailable('INCOMPARABLE_COUNTER', evidenceSnapshotIds);
  return {
    availability: 'AVAILABLE',
    metric,
    valuePerHour:
      Math.round(((after.value - before.value) / elapsedHours) * 100) / 100,
    elapsedHours: Math.round(elapsedHours * 100) / 100,
    evidenceSnapshotIds,
  };
}

export function calculateHistoricalVelocity(
  snapshots: any,
  metric: any = 'views',
): any {
  const ordered: any = [...snapshots].sort(
    (left: any, right: any): any =>
      Date.parse(left.capturedAt) - Date.parse(right.capturedAt) ||
      left.id.localeCompare(right.id),
  );
  return ordered.slice(1).map((snapshot: any, index: any): any => ({
    fromSnapshotId: ordered[index].id,
    toSnapshotId: snapshot.id,
    result: calculateSnapshotVelocity(ordered[index], snapshot, metric),
  }));
}

function unavailable(reason: any, evidenceSnapshotIds: any): any {
  return { availability: 'UNAVAILABLE', reason, evidenceSnapshotIds };
}
