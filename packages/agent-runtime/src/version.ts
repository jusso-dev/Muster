/**
 * The runtime graph version is stamped on every run and every checkpoint.
 *
 * A run always resumes against the graph version it started with. When the
 * compiled graph changes shape in a way that would invalidate an in-flight
 * checkpoint, bump this constant and add the old version to
 * {@link retiredGraphVersions}. Resuming a retired version fails explicitly
 * with a migration requirement rather than silently replaying a run against a
 * graph it never executed.
 */
export const AGENT_RUNTIME_GRAPH_VERSION = "muster.agent-runtime.graph/1";

/**
 * Versions this build can still resume. Only ever contains versions whose
 * checkpoint shape is byte-compatible with the current graph.
 */
export const resumableGraphVersions: ReadonlySet<string> = new Set([
  AGENT_RUNTIME_GRAPH_VERSION,
]);

/**
 * Versions that were written by an older graph and can no longer be resumed.
 * Kept explicit so operators get a named migration requirement instead of an
 * unknown-version error.
 */
export const retiredGraphVersions: ReadonlyMap<string, string> = new Map();

export type GraphVersionCompatibility =
  | { compatible: true }
  | { compatible: false; reason: string; migrationRequired: boolean };

export function checkGraphVersion(
  recorded: string | null | undefined,
): GraphVersionCompatibility {
  if (!recorded) {
    return {
      compatible: false,
      reason:
        "The run has no recorded runtime graph version and cannot be resumed by the stateful runtime.",
      migrationRequired: true,
    };
  }
  if (resumableGraphVersions.has(recorded)) return { compatible: true };
  const retirement = retiredGraphVersions.get(recorded);
  if (retirement) {
    return { compatible: false, reason: retirement, migrationRequired: true };
  }
  return {
    compatible: false,
    reason: `Run was started on unknown runtime graph version ${recorded}; this worker runs ${AGENT_RUNTIME_GRAPH_VERSION}.`,
    migrationRequired: true,
  };
}
