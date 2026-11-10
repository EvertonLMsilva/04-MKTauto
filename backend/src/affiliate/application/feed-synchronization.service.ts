import { readFile } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import {
  affiliateHash,
  immutable,
  validateAffiliateProduct,
  validateAffiliateCampaign,
  collectAffiliateProductIssues,
  type AffiliateProduct,
  type AffiliateCampaign,
} from '../domain/affiliate-contracts.js';
import {
  qualifyFeedRows,
  type RawQualificationRow,
} from '../domain/feed-qualification.js';
import { readQualificationFeeds } from '../infrastructure/feed-qualification.source.js';

const version = 'affiliate-feed-snapshot/1.0.0';
const comparisonVersion = 'affiliate-feed-comparison/1.0.0';
const digest = (payload: unknown) => affiliateHash({ payload });
const fail = (code: string): never => {
  throw Object.assign(new Error(code), { code });
};
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000)
    fail('FEED_SNAPSHOT_INVALID_INPUT');
}
function timestamp(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/(Z|[+-]\d\d:\d\d)$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail('FEED_SNAPSHOT_INVALID_DATE');
}
interface DatedEvidence {
  at: string;
  evidenceRef: string;
}
interface SnapshotRequest {
  configPath: string;
  feedId: string;
  sourceRef: string;
  obtained?: DatedEvidence | null;
  reference?: DatedEvidence | null;
  validUntil?: DatedEvidence | null;
}
function dated(raw: DatedEvidence | null | undefined): DatedEvidence | null {
  if (raw == null) return null;
  timestamp(raw.at);
  text(raw.evidenceRef);
  return { at: new Date(raw.at).toISOString(), evidenceRef: raw.evidenceRef };
}
interface SnapshotBody {
  schemaVersion: string;
  origin: {
    provider: string;
    feedId: string;
    sourceRef: string;
    independentlyVerified: boolean;
  };
  file: {
    formatVersion: string;
    encoding: string;
    name: string;
    sha256: string;
    sizeBytes: number;
    headers: string[];
    columnMapping: Record<string, string>;
  };
  dates: {
    obtained: DatedEvidence | null;
    reference: DatedEvidence | null;
    validUntil: DatedEvidence | null;
  };
  rows: RawQualificationRow[];
}
export interface FeedSnapshot extends SnapshotBody {
  snapshotId: string;
}

// Explicit offline source; no app, SQLite, cache write, grant or remote transport.
export async function createFeedSnapshot(
  input: SnapshotRequest,
): Promise<FeedSnapshot> {
  text(input?.configPath);
  text(input.feedId);
  text(input.sourceRef);
  if (!isAbsolute(input.configPath)) fail('FEED_SNAPSHOT_INVALID_INPUT');
  const configBytes = await readFile(input.configPath, 'utf8');
  const config = JSON.parse(configBytes);
  if (
    !Array.isArray(config?.feeds) ||
    config.feeds.length !== 1 ||
    config.feeds[0]?.feedId !== input.feedId
  )
    fail('FEED_SNAPSHOT_SINGLE_SOURCE_REQUIRED');
  const dates = {
    obtained: dated(input.obtained),
    reference: dated(input.reference),
    validUntil: dated(input.validUntil),
  };
  if (
    dates.reference &&
    dates.validUntil &&
    Date.parse(dates.validUntil.at) < Date.parse(dates.reference.at)
  )
    fail('FEED_SNAPSHOT_INVALID_DATE');
  // Optional currency observation leaves all existing qualification consumers unchanged.
  const { rows, sources } = await readQualificationFeeds(
    input.configPath,
    true,
  );
  if ((await readFile(input.configPath, 'utf8')) !== configBytes)
    fail('EXTERNAL_CATALOG_SOURCE_INTEGRITY');
  const source = sources[0];
  const body: SnapshotBody = {
    schemaVersion: version,
    origin: {
      provider: 'shopee',
      feedId: source.feedId,
      sourceRef: input.sourceRef,
      independentlyVerified: false,
    },
    file: {
      formatVersion: 'affiliate-observed-csv/1.0.0',
      encoding: 'UTF-8',
      name: basename(config.feeds[0].sourcePath),
      sha256: source.sha256,
      sizeBytes: source.sizeBytes,
      headers: source.headers,
      columnMapping: source.columnMapping as Record<string, string>,
    },
    // Filename, filesystem mtime and unsubstantiated config dates are not evidence.
    dates,
    rows,
  };
  return immutable({ ...body, snapshotId: digest(body) });
}
function validateSnapshot(raw: FeedSnapshot) {
  if (!raw || typeof raw !== 'object') fail('FEED_SNAPSHOT_INTEGRITY');
  const { snapshotId, ...body } = raw;
  if (typeof snapshotId !== 'string' || snapshotId !== digest(body))
    fail('FEED_SNAPSHOT_INTEGRITY');
  if (
    body.schemaVersion !== version ||
    body.origin?.provider !== 'shopee' ||
    body.origin.independentlyVerified !== false ||
    body.file?.formatVersion !== 'affiliate-observed-csv/1.0.0' ||
    body.file?.encoding !== 'UTF-8' ||
    !/^[a-f0-9]{64}$/.test(body.file?.sha256) ||
    !Array.isArray(body.rows) ||
    !Array.isArray(body.file?.headers)
  )
    fail('FEED_SNAPSHOT_FORMAT_INVALID');
  text(body.origin.feedId);
  text(body.origin.sourceRef);
  text(body.file.name);
  if (
    !body.dates ||
    !body.file.columnMapping ||
    !Number.isSafeInteger(body.file.sizeBytes) ||
    body.file.sizeBytes < 0
  )
    fail('FEED_SNAPSHOT_FORMAT_INVALID');
  dated(body.dates.obtained);
  dated(body.dates.reference);
  dated(body.dates.validUntil);
  const seen = new Set<number>();
  for (const row of body.rows) {
    if (
      !row ||
      row.feedId !== body.origin.feedId ||
      !Number.isSafeInteger(row.rowNumber) ||
      row.rowNumber < 2 ||
      seen.has(row.rowNumber) ||
      !row.value ||
      typeof row.value !== 'object' ||
      Array.isArray(row.value) ||
      Object.values(row.value).some((v) => typeof v !== 'string')
    )
      fail('FEED_SNAPSHOT_FORMAT_INVALID');
    seen.add(row.rowNumber);
  }
}
const observedKeys = [
  'name',
  'attributes',
  'category',
  'subcategory',
  'historicalPrice',
  'salePrice',
  'productUrl',
  'reportedAffiliateUrl',
  'imageUrl',
  'currency',
] as const;
function observed(
  row: RawQualificationRow,
): Record<(typeof observedKeys)[number], unknown> {
  return Object.fromEntries(
    observedKeys.map((key) => {
      const value = row.value[key]?.trim() ?? '';
      // Parsed JSON normalizes object key order with the existing canonical hasher.
      if (key === 'attributes' && value) {
        try {
          return [key, JSON.parse(value) as unknown];
        } catch {
          /* Triager records invalid attributes. */
        }
      }
      return [key, value || null];
    }),
  ) as Record<(typeof observedKeys)[number], unknown>;
}
function index(snapshot: FeedSnapshot) {
  const qualified = qualifyFeedRows(snapshot.rows);
  const byRow = new Map(qualified.map((r) => [r.source.rowNumber, r]));
  const groups = new Map<
    string,
    { row: RawQualificationRow; qualification: (typeof qualified)[number] }[]
  >();
  for (const row of snapshot.rows) {
    const q = byRow.get(row.rowNumber)!;
    if (!q.externalProductId || q.reasons.includes('PRODUCT_ID_INVALID'))
      continue;
    const group = groups.get(q.externalProductId) ?? [];
    group.push({ row, qualification: q });
    groups.set(q.externalProductId, group);
  }
  return { groups, qualified };
}
interface RegisteredExport {
  externalProductId: string;
  mappingEvidenceRef: string;
  product: AffiliateProduct;
  offers: AffiliateCampaign[];
}
function proposal(
  reg: RegisteredExport,
  change: ReturnType<typeof changeItem>,
  snapshot: FeedSnapshot,
  evaluatedAt: string,
) {
  text(reg.mappingEvidenceRef);
  const product = validateAffiliateProduct(reg.product);
  if (!Array.isArray(reg.offers)) fail('FEED_REVISION_EXPORT_INVALID');
  const offers = reg.offers.map(validateAffiliateCampaign);
  if (
    offers.some(
      (o) =>
        o.productId !== product.productId ||
        o.productRevision !== product.revision,
    )
  )
    fail('FEED_REVISION_EXPORT_INVALID');
  const duplicates = new Set<string>();
  for (const o of offers) {
    if (duplicates.has(o.campaignId)) fail('FEED_REVISION_EXPORT_INVALID');
    duplicates.add(o.campaignId);
  }
  const pending = [
    'HUMAN_REVIEW_REQUIRED',
    'CURRENT_REVISIONS_UNVERIFIED',
    'STORE_DATA_NOT_VERIFIED',
  ];
  const nameDifferent = !!change.after && change.after.name !== product.name;
  const attributesNeedReview = change.changedFields.some((k) =>
    ['attributes', 'category', 'subcategory'].includes(k),
  );
  const revisionNeeded = nameDifferent || attributesNeedReview;
  const eligible =
    !!change.after && change.issues.length === 0 && revisionNeeded;
  const draft = structuredClone(product);
  if (eligible) {
    draft.revision++;
    draft.name = change.after!.name as string;
    draft.evidence.push({
      id: 'ev_sync_' + snapshot.snapshotId.slice(0, 24),
      kind: 'PRODUCT_SPECIFICATION',
      sourceRef: `local-feed:sha256:${snapshot.file.sha256}:row:${change.afterRow}:itemid:${reg.externalProductId}`,
      recordedAt: evaluatedAt,
    });
  }
  if (
    change.changedFields.some((k) =>
      ['attributes', 'category', 'subcategory'].includes(k),
    )
  )
    pending.push('ATTRIBUTE_MAPPING_REVIEW_REQUIRED');
  if (change.issues.length)
    pending.push('SOURCE_DATA_INCOMPLETE_OR_DUPLICATED');
  if (change.presence === 'ABSENT_FROM_SNAPSHOT')
    pending.push('ABSENCE_IS_NOT_STORE_DELETION');
  if (
    change.changedFields.some((k) =>
      ['productUrl', 'reportedAffiliateUrl'].includes(k),
    )
  )
    pending.push('AFFILIATE_LINK_REVIEW_REQUIRED_NO_URL_CHANGE_AUTHORIZED');
  const issues = eligible ? collectAffiliateProductIssues(draft) : [];
  if (issues.length) pending.push('PRODUCT_DRAFT_CONTRACT_INVALID');
  return {
    externalProductId: reg.externalProductId,
    productId: product.productId,
    currentRevision: product.revision,
    baseProductHash: digest(product),
    mappingEvidenceRef: reg.mappingEvidenceRef,
    proposedRevision: eligible ? draft.revision : null,
    productDraft: eligible
      ? { idempotencyKey: 'feedsync_product_' + digest(draft), product: draft }
      : null,
    offerDrafts: eligible
      ? offers.map((o) => {
          const campaign = {
            ...structuredClone(o),
            revision: o.revision + 1,
            productRevision: draft.revision,
          };
          validateAffiliateCampaign(campaign);
          return {
            idempotencyKey: 'feedsync_offer_' + digest(campaign),
            campaign,
          };
        })
      : [],
    existingAttributes: product.attributes,
    observedAttributes: change.after?.attributes ?? null,
    changes: change.changedFields,
    productIssues: issues,
    registeredDifferences: {
      name: nameDifferent
        ? { before: product.name, after: change.after!.name }
        : null,
      attributesNeedReview,
    },
    // No dynamic price/commission goes into the product DTO. No rights or URL rewriting.
    commercialEvidenceOnly: !revisionNeeded,
    pending,
    currentRevisionsVerified: false,
    catalogEligible: false,
    finalPayload: null,
  };
}
function changeItem(
  id: string,
  left: ReturnType<typeof index>['groups'],
  right: ReturnType<typeof index>['groups'],
) {
  const a = left.get(id) ?? [],
    b = right.get(id) ?? [];
  const before = a.length === 1 ? observed(a[0].row) : null;
  const after = b.length === 1 ? observed(b[0].row) : null;
  const changedFields =
    before && after
      ? observedKeys.filter((k) => digest(before[k]) !== digest(after[k]))
      : [];
  const issues = [];
  if (a.length > 1 || b.length > 1) issues.push('DUPLICATE_PRODUCT');
  if ([...a, ...b].some((x) => !x.qualification.dataSufficientForAnalysis))
    issues.push('INCOMPLETE_DATA');
  return {
    externalProductId: id,
    presence: !a.length
      ? 'NEW_IN_SNAPSHOT'
      : !b.length
        ? 'ABSENT_FROM_SNAPSHOT'
        : issues.length
          ? 'REVIEW_REQUIRED'
          : changedFields.length
            ? 'CHANGED'
            : 'UNCHANGED_OBSERVABLE',
    changedFields,
    issues,
    before,
    after: after ? { ...after, availability: null, commission: null } : null,
    beforeRows: a.map((x) => x.row.rowNumber),
    afterRows: b.map((x) => x.row.rowNumber),
    afterRow: b[0]?.row.rowNumber ?? null,
    observedFields: after ? observedKeys.filter((k) => after[k] !== null) : [],
    missingFields: after
      ? observedKeys.filter((k) => after[k] === null)
      : [...observedKeys],
    currentPrice: false,
    storeVerified: false,
    absenceProvesDeletion: false,
  };
}
export function compareFeedSnapshots(
  before: FeedSnapshot,
  after: FeedSnapshot,
  evaluatedAt: string,
  registered: RegisteredExport[] = [],
) {
  validateSnapshot(before);
  validateSnapshot(after);
  timestamp(evaluatedAt);
  if (digest(before.origin) !== digest(after.origin))
    fail('FEED_SNAPSHOT_ORIGIN_MISMATCH');
  if (digest(before.file.columnMapping) !== digest(after.file.columnMapping))
    fail('FEED_SNAPSHOT_FORMAT_MISMATCH');
  if (
    before.dates.reference &&
    after.dates.reference &&
    Date.parse(before.dates.reference.at) > Date.parse(after.dates.reference.at)
  )
    fail('FEED_SNAPSHOT_REVERSED_REFERENCE_ORDER');
  if (
    after.dates.reference &&
    Date.parse(after.dates.reference.at) > Date.parse(evaluatedAt)
  )
    fail('FEED_SNAPSHOT_INVALID_DATE');
  const a = index(before),
    b = index(after);
  const items = [...new Set([...a.groups.keys(), ...b.groups.keys()])]
    .sort()
    .map((id) => changeItem(id, a.groups, b.groups));
  if (!Array.isArray(registered)) fail('FEED_REVISION_EXPORT_INVALID');
  const regs = new Map<string, RegisteredExport>();
  const productIds = new Set<string>();
  for (const reg of registered) {
    if (
      !reg ||
      !/^[1-9]\d{0,39}$/.test(reg.externalProductId) ||
      regs.has(reg.externalProductId) ||
      !reg.product ||
      productIds.has(reg.product.productId)
    )
      fail('FEED_REVISION_EXPORT_INVALID');
    productIds.add(reg.product.productId);
    regs.set(reg.externalProductId, reg);
  }
  const byId = new Map(items.map((i) => [i.externalProductId, i]));
  const revisionProposals = [...regs]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, reg]) => {
      const change = byId.get(id);
      if (!change) fail('FEED_REVISION_PRODUCT_NOT_IN_SNAPSHOTS');
      return proposal(reg, change!, after, evaluatedAt);
    });
  const body = {
    schemaVersion: comparisonVersion,
    beforeSnapshotId: before.snapshotId,
    afterSnapshotId: after.snapshotId,
    origin: after.origin,
    evaluatedAt,
    chronology:
      before.dates.reference && after.dates.reference
        ? 'DOCUMENTED_REFERENCE_ORDER'
        : 'ORDER_UNVERIFIED',
    freshness: {
      temporalBasis: after.dates.reference ? 'DOCUMENTED_REFERENCE' : 'UNDATED',
      validity:
        after.dates.validUntil && after.dates.reference
          ? Date.parse(after.dates.validUntil.at) < Date.parse(evaluatedAt)
            ? 'EXPIRED'
            : 'WITHIN_DOCUMENTED_VALIDITY'
          : 'UNPROVEN',
      dates: after.dates,
      storeVerification: 'NOT_VERIFIED',
      currentPriceConfirmed: false,
      availability: null,
      commission: null,
    },
    summary: {
      new: items.filter((i) => i.presence === 'NEW_IN_SNAPSHOT').length,
      absent: items.filter((i) => i.presence === 'ABSENT_FROM_SNAPSHOT').length,
      changed: items.filter((i) => i.presence === 'CHANGED').length,
      unchanged: items.filter((i) => i.presence === 'UNCHANGED_OBSERVABLE')
        .length,
      duplicateProducts: items.filter((i) =>
        i.issues.includes('DUPLICATE_PRODUCT'),
      ).length,
      incompleteRecordsAfter: b.qualified.filter(
        (q) => !q.dataSufficientForAnalysis,
      ).length,
      requiresCommercialReconfirmation: b.qualified.length,
    },
    incompleteRecords: {
      before: a.qualified.filter((q) => !q.dataSufficientForAnalysis),
      after: b.qualified.filter((q) => !q.dataSufficientForAnalysis),
    },
    items,
    revisionProposals,
    registrationAuthorized: false,
    operationalWrites: false,
  };
  return immutable({ ...body, reportId: digest(body) });
}
