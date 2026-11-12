import type {
  RunFinanceReadiness,
  RunFinancialOperation,
} from './finance.types.js';
import type {
  RunCostCoverage,
  StageCostStatus,
  CoverageDocument,
} from './run-cost-coverage.types.js';
import {
  coverageFail,
  validateCostPerimeter,
} from './run-cost-coverage.validation.js';
import { validateCostEvent } from './cost-event-contracts.js';
import { validateAdjustment } from './cost-adjustment-contracts.js';
import { usdUnits } from './video-financial-contracts.js';

const opKey = (op: Pick<RunFinancialOperation, 'source' | 'operationId'>) =>
  `${op.source}:${op.operationId}`;
export function evaluateRunCostCoverage(
  pipelineRunId: string,
  run: RunFinanceReadiness,
  declaration?: unknown,
): RunCostCoverage {
  const ledger = run.ledger;
  if (
    run.schemaVersion !== 'run-finance-readiness/1.0.0' ||
    ledger.schemaVersion !== 'cost-ledger/2.0.0' ||
    pipelineRunId !== run.pipelineRunId ||
    pipelineRunId !== ledger.pipelineRunId
  )
    coverageFail('COVERAGE_RUN_MISMATCH', 'pipelineRunId');
  const events = new Map(
    ledger.events.map((event) => {
      validateCostEvent(event);
      if (
        event.pipelineRunId !== pipelineRunId ||
        event.projectId !== ledger.projectId ||
        event.projectVersion !== ledger.projectVersion
      )
        coverageFail('COVERAGE_PROJECT_MISMATCH', 'event');
      return [event.costEventId, event] as const;
    }),
  );
  const operations = new Map(
    run.operations.map((op) => {
      if (op.actualCostUsd !== null) usdUnits(op.actualCostUsd);
      return [opKey(op), op] as const;
    }),
  );
  const entries = new Map(
    run.entries.map((entry) => {
      usdUnits(entry.netAmount);
      if (
        !events.has(entry.costEventId) ||
        events.get(entry.costEventId)!.currency !== entry.currency
      )
        coverageFail('COVERAGE_EVENT_MISMATCH', 'entries');
      return [entry.costEventId, entry] as const;
    }),
  );
  if (
    events.size !== ledger.events.length ||
    entries.size !== run.entries.length ||
    entries.size !== events.size ||
    operations.size !== run.operations.length
  )
    coverageFail('COVERAGE_DUPLICATE_CLAIM', 'financialResult');
  const adjustments = new Set<string>();
  for (const a of ledger.adjustments) {
    validateAdjustment(a);
    if (
      adjustments.has(a.adjustmentId) ||
      !events.has(a.originalCostEventId) ||
      events.get(a.originalCostEventId)!.currency !== a.currency
    )
      coverageFail('COVERAGE_ADJUSTMENT_MISMATCH', 'adjustments');
    adjustments.add(a.adjustmentId);
  }
  ledger.totalsByCurrency.forEach((t) => {
    usdUnits(t.amount);
    if (!/^[A-Z]{3}$/.test(t.currency))
      coverageFail('COVERAGE_CURRENCY_MISMATCH', 'ledger');
  });
  const d =
    declaration === undefined ? null : validateCostPerimeter(declaration);
  if (
    d &&
    (d.pipelineRunId !== pipelineRunId ||
      d.projectId !== ledger.projectId ||
      d.projectVersion !== ledger.projectVersion ||
      d.runIdentityHash !== run.runIdentityHash)
  )
    coverageFail('COVERAGE_IDENTITY_MISMATCH', 'declaration');
  const docs = new Map(
    d?.evidence.map((doc) => {
      if (
        doc.pipelineRunId !== pipelineRunId ||
        doc.projectId !== ledger.projectId ||
        doc.projectVersion !== ledger.projectVersion
      )
        coverageFail('COVERAGE_EVIDENCE_SCOPE_MISMATCH', doc.evidenceId);
      return [doc.evidenceId, doc] as const;
    }),
  );
  const usedEvents = new Set<string>(),
    usedOps = new Set<string>();
  const blockers = new Set<string>(),
    missing = new Set<string>();
  function documents(
    ids: string[],
    stageId: string | null,
  ): CoverageDocument[] {
    return ids
      .map((id) => {
        const doc = docs.get(id);
        if (!doc) {
          missing.add(id);
          return null;
        }
        if (doc.stageId !== stageId)
          coverageFail('COVERAGE_EVIDENCE_STAGE_MISMATCH', id);
        return doc;
      })
      .filter((v): v is CoverageDocument => v !== null);
  }
  const perimeterDocs = documents(d?.perimeterEvidenceIds ?? [], null);
  const perimeterProven =
    !!d?.complete &&
    !!d.stages.length &&
    !!perimeterDocs.length &&
    perimeterDocs.length === d.perimeterEvidenceIds.length &&
    perimeterDocs.every((doc) => doc.kind === 'PERIMETER');
  if (!d) blockers.add('PERIMETER_NOT_DECLARED');
  if (d && !d.stages.length) blockers.add('EMPTY_PERIMETER');
  if (!perimeterProven) {
    blockers.add('PERIMETER_EVIDENCE_REQUIRED');
    missing.add('perimeter');
  }
  const stages: RunCostCoverage['stages'] = (d?.stages ?? []).map((stage) => {
    const reasons = new Set<string>(),
      stageMissing: string[] = [];
    const stageEvents = stage.costEventIds.map((id) => {
      if (!events.has(id)) coverageFail('COVERAGE_EVENT_NOT_FOUND', id);
      if (usedEvents.has(id)) coverageFail('COVERAGE_DUPLICATE_CLAIM', id);
      usedEvents.add(id);
      return events.get(id)!;
    });
    const stageOps = stage.operations.map((claim) => {
      const key = opKey(claim),
        op = operations.get(key);
      if (!op || op.requestHash !== claim.requestHash)
        coverageFail('COVERAGE_OPERATION_MISMATCH', key);
      if (usedOps.has(key)) coverageFail('COVERAGE_DUPLICATE_CLAIM', key);
      usedOps.add(key);
      return op;
    });
    const stageDocs = documents(stage.evidenceIds, stage.stageId);
    for (const id of stage.evidenceIds)
      if (!docs.has(id)) stageMissing.push(id);
    for (const doc of stageDocs.filter((doc) => doc.kind === 'BILLING')) {
      const currencies = new Set([
        ...stageEvents.map((event) => event.currency),
        ...stageOps.map((op) => op.currency),
      ]);
      if (currencies.size && !currencies.has(doc.currency!))
        coverageFail('COVERAGE_CURRENCY_MISMATCH', doc.evidenceId);
    }
    let status: StageCostStatus;
    if (stage.applicability === 'NOT_APPLICABLE') {
      if (stageEvents.length || stageOps.length)
        coverageFail('COVERAGE_NOT_APPLICABLE_CONFLICT', stage.stageId);
      const documented =
        !!stage.justification?.trim() &&
        stageDocs.some((doc) => doc.kind === 'NOT_APPLICABLE') &&
        !stageMissing.length;
      status = documented ? 'NOT_APPLICABLE_DOCUMENTED' : 'PARTIAL_EVIDENCE';
      if (!documented) {
        reasons.add('NOT_APPLICABLE_JUSTIFICATION_AND_EVIDENCE_REQUIRED');
        stageMissing.push(`not-applicable:${stage.stageId}`);
      }
    } else if (!stageEvents.length && !stageOps.length) {
      status = 'NOT_OBSERVED';
      reasons.add('STAGE_COST_NOT_OBSERVED');
      stageMissing.push(`stage:${stage.stageId}`);
    } else {
      const uncertain = stageOps.some(
        (op) =>
          op.actualCostUsd === null ||
          ['UNKNOWN', 'SUBMITTING', 'SUBMITTED', 'RESERVED'].includes(op.state),
      );
      for (const op of stageOps) {
        if (
          op.actualCostUsd !== null &&
          usdUnits(op.actualCostUsd) > 0n &&
          !op.costEventIds.length
        )
          reasons.add(`OPERATION_COST_NOT_IN_LEDGER:${opKey(op)}`);
        if (
          !op.evidenceReference ||
          !stageDocs.some(
            (doc) =>
              doc.kind === 'BILLING' &&
              doc.currency === op.currency &&
              doc.reference === op.evidenceReference,
          )
        )
          stageMissing.push(`billing:${opKey(op)}`);
        if (!op.reconciled)
          reasons.add(`OPERATION_NOT_RECONCILED:${opKey(op)}`);
        if (op.costEventIds.some((id) => !stage.costEventIds.includes(id)))
          reasons.add(`OPERATION_EVENTS_NOT_ASSIGNED:${opKey(op)}`);
      }
      for (const event of stageEvents) {
        if (!entries.get(event.costEventId)!.reconciled)
          reasons.add(`EVENT_NOT_RECONCILED:${event.costEventId}`);
        if (!stageOps.some((op) => op.costEventIds.includes(event.costEventId)))
          reasons.add(`EVENT_OPERATION_NOT_ASSIGNED:${event.costEventId}`);
      }
      if (!stageOps.length) stageMissing.push(`billing:${stage.stageId}`);
      if (stageMissing.length) reasons.add('BILLING_EVIDENCE_REQUIRED');
      status = uncertain
        ? 'UNKNOWN'
        : !reasons.size
          ? 'RECONCILED'
          : stageDocs.length || stageOps.some((op) => op.reconciled)
            ? 'PARTIAL_EVIDENCE'
            : 'RECORDED';
    }
    for (const code of reasons) blockers.add(`${stage.stageId}:${code}`);
    stageMissing.forEach((id) => missing.add(id));
    return {
      stageId: stage.stageId,
      status,
      justification: stage.justification ?? null,
      costEventIds: [...stage.costEventIds],
      operationKeys: stageOps.map(opKey),
      evidenceIds: [...stage.evidenceIds],
      missingEvidence: stageMissing,
      blockers: [...reasons].sort(),
    };
  });
  const coveredStages = stages
    .filter((s) =>
      ['RECONCILED', 'NOT_APPLICABLE_DOCUMENTED'].includes(s.status),
    )
    .map((s) => s.stageId);
  const notCoveredStages = stages
    .filter((s) => !coveredStages.includes(s.stageId))
    .map((s) => s.stageId);
  const unassignedCostEventIds = [...events.keys()].filter(
    (id) => !usedEvents.has(id),
  );
  const unassignedOperations = [...operations.keys()].filter(
    (id) => !usedOps.has(id),
  );
  if (unassignedCostEventIds.length) blockers.add('UNASSIGNED_COST_EVENTS');
  if (unassignedOperations.length) blockers.add('UNASSIGNED_OPERATIONS');
  const unknown =
    stages.some((s) => s.status === 'UNKNOWN') || run.unknownCosts.length > 0;
  const complete =
    perimeterProven &&
    !notCoveredStages.length &&
    !blockers.size &&
    !missing.size;
  return {
    schemaVersion: 'run-cost-coverage/1.0.0',
    pipelineRunId,
    projectId: ledger.projectId,
    projectVersion: ledger.projectVersion,
    runIdentityHash: run.runIdentityHash,
    scope: 'DECLARED_PERIMETER',
    perimeterEvidenceIds: [...(d?.perimeterEvidenceIds ?? [])],
    evidence: [...(d?.evidence ?? [])],
    coverageStatus: unknown
      ? 'UNKNOWN'
      : complete
        ? 'DOCUMENTED_PERIMETER_COVERED'
        : perimeterProven
          ? 'PARTIAL_COVERAGE'
          : 'COVERAGE_UNVERIFIED',
    stages,
    coveredStages,
    notCoveredStages,
    unassignedCostEventIds,
    unassignedOperations,
    missingEvidence: [...missing].sort(),
    blockers: [...blockers].sort(),
    knownFinancialTotals: ledger.totalsByCurrency,
    totalRunCost:
      complete && !unknown && ledger.totalsByCurrency.length
        ? ledger.totalsByCurrency
        : null,
    financiallyClosed: false,
    spendingAuthorized: false,
  };
}
