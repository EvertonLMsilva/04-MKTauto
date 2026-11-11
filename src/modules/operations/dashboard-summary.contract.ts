export type UnavailableReason =
  | 'ACTIVE_CAMPAIGN_DEFINITION_REQUIRED'
  | 'COMBINED_PUBLICATIONS_UNDEFINED'
  | 'MEDIA_MATERIALIZATION_NOT_PROVEN'
  | 'DATABASE_NOT_CONFIGURED'
  | 'DATABASE_UNAVAILABLE'
  | 'SCHEMA_INCOMPATIBLE'
  | 'SOURCE_READ_FAILED'
  | 'PUBLICATION_SCOPE_UNAVAILABLE'
  | 'PUBLICATION_MODE_NOT_IN_SOURCE'
  | 'INVALID_PUBLICATION_SOURCE'
  | 'PUBLICATION_IDENTITY_CONFLICT'
  | 'INVALID_QC_SOURCE'
  | 'QC_IDENTITY_CONFLICT'
  | 'INVALID_AGGREGATE'
  | 'NO_QC_EVALUATIONS';

export interface Measurement {
  value: number | null;
  reason: UnavailableReason | null;
}

export const measuredKeys = [
  'runningExecutions',
  'generatedMedia',
  'socialPublicationsFake',
  'socialPublicationsLive',
  'qcApproved',
  'qcEvaluated',
] as const;
export type MeasuredKey = (typeof measuredKeys)[number];
export type MetricKey =
  MeasuredKey | 'activeCampaigns' | 'completedPublications' | 'qcApprovalRate';
export type DashboardReadSnapshot = Record<MeasuredKey, Measurement> & {
  generatedAt: string;
  publicationMode: 'fake' | 'live' | null;
};
export interface DashboardSummaryReader {
  read(): DashboardReadSnapshot;
}
export interface Availability {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  reason: UnavailableReason | null;
}

/**
 * Read-only historical statistics, never authorization to publish or approve.
 * Browser access requires the existing QC session on a compatible local origin;
 * distinct React/API origins need a separately authorized same-origin setup.
 * No reviewer secret belongs in VITE_* or in this response. GET needs no CSRF token.
 */
export const summaryScope = {
  period: 'all_time',
  source: 'PROJECT_API_DATABASE',
  publicationSource: 'social_publication_operations',
  publicationHistoryDatabaseIncluded: false,
  manualPublicationsIncluded: false,
  qcFamily: 'quality-control-report/1.0.0',
  qcPolicy: 'quality-control-policy/1.0.0',
  qcHumanApprovalIncluded: false,
  access: 'local-qc-same-origin',
  units: {
    activeCampaigns: 'undefined',
    runningExecutions: 'execution_id_with_status_RUNNING',
    generatedMedia:
      'unique_materialized_provider_generated_content_hash_unproven',
    socialPublicationsFake: 'fake_published_network_account_remote_media_id',
    socialPublicationsLive: 'live_published_network_account_remote_media_id',
    completedPublications: 'combined_total_undefined',
    qcApproved: 'V1_PASS_evaluation',
    qcEvaluated: 'V1_PASS_WARN_FAIL_unique_policy_render_hash_evaluation',
    qcApprovalRate: 'percent_PASS_over_PASS_WARN_FAIL',
  },
} as const;

export type DashboardSummary = Record<MetricKey, number | null> & {
  schemaVersion: 'operations-dashboard-summary/1.0.0';
  generatedAt: string;
  scope: typeof summaryScope & { publicationMode: 'fake' | 'live' | null };
  availability: Record<MetricKey, Availability>;
};
