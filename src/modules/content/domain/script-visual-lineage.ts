/** Reuse immutable visual evidence only across narration-only registered revisions. */
export function visualScriptMatches(
  current: Record<string, any>,
  sourceId: string,
  sourceHash: string,
  load: (id: string) => Record<string, any> | null,
): boolean {
  const preserved = [
    'schemaVersion',
    'pipelineRunId',
    'projectId',
    'projectVersion',
    'ideaSelectionId',
    'ideaSelectionContentHash',
    'ideaCandidateId',
    'ideaContentHash',
    'editorialSelectionId',
    'editorialSelectionContentHash',
    'language',
    'contentFormat',
    'visualDirections',
    'sensitiveClaims',
    'reviewFlags',
    'cta',
  ];
  let script = current;
  const seen = new Set<string>();
  for (let depth = 0; depth < 100; depth++) {
    if (script.scriptId === sourceId) return script.contentHash === sourceHash;
    if (!script.supersedesScriptId || seen.has(script.scriptId)) return false;
    seen.add(script.scriptId);
    const previous = load(script.supersedesScriptId);
    if (
      !previous ||
      previous.revision + 1 !== script.revision ||
      preserved.some(
        (key) => JSON.stringify(previous[key]) !== JSON.stringify(script[key]),
      )
    )
      return false;
    script = previous;
  }
  return false;
}
