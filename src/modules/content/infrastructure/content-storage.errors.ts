/** Contains only an SQLSTATE and allowlisted constraint identity, never SQL or values. */
export class ContentStorageError extends Error {
  constructor(
    readonly sqlState: string,
    readonly constraint: string,
  ) {
    super('CONTENT_STORAGE_FAILED');
    this.name = 'ContentStorageError';
  }
}
export function contentStorageFailure(error: unknown): ContentStorageError {
  const value = error as { code?: unknown; constraint?: unknown };
  return new ContentStorageError(
    typeof value?.code === 'string' && /^[0-9A-Z]{5}$/.test(value.code)
      ? value.code
      : 'XXXXX',
    typeof value?.constraint === 'string' &&
      /^(idea_|scripts_|artifact_lineage_|affiliate_editorial_)[a-z_]+$/.test(
        value.constraint,
      )
      ? value.constraint
      : '',
  );
}
/** Domain mappers keep owning the public error classes and messages. */
export function contentStorageMarker(error: ContentStorageError): string {
  const constraints: Record<string, string> = {
    idea_candidates_content_identity_key: 'idea_candidates.content_identity',
    idea_candidates_pkey: 'idea_candidates.idea_candidate_id',
    idea_selections_idea_batch_id_revision_key:
      'idea_selections.idea_batch_id, idea_selections.revision',
    idea_selections_supersedes_idea_selection_id_key:
      'idea_selections.supersedes_idea_selection_id',
    scripts_idea_selection_id_revision_key:
      'scripts.idea_selection_id, scripts.revision',
    scripts_commercial_selection_id_revision_key:
      'scripts.idea_selection_id, scripts.revision',
    scripts_supersedes_script_id_key: 'scripts.supersedes_script_id',
    artifact_lineage_pkey: 'artifact_lineage.artifact_id',
    artifact_lineage_artifact_type_content_identity_artifact_versi_key:
      'artifact_lineage.artifact_type, artifact_lineage.content_identity, artifact_lineage.artifact_version',
  };
  return error.sqlState === '23505'
    ? (constraints[error.constraint] ?? '')
    : '';
}
