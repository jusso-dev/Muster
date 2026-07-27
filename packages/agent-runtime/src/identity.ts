import { z } from "zod";

/**
 * Every checkpoint namespace carries the full tenant path. Identifiers are
 * derived, never accepted from a model or from external content.
 */
export const RuntimeScopeSchema = z.object({
  organisationId: z.uuid(),
  agentId: z.uuid(),
  conversationId: z.string().trim().min(1).max(200),
  runId: z.uuid(),
});

export type RuntimeScope = z.infer<typeof RuntimeScopeSchema>;

export function runtimeScope(input: RuntimeScope): RuntimeScope {
  return RuntimeScopeSchema.parse(input);
}

/** `muster:{organisationId}:{agentId}:{conversationId}` */
export function threadIdFor(
  scope: Pick<RuntimeScope, "organisationId" | "agentId" | "conversationId">,
): string {
  return `muster:${scope.organisationId}:${scope.agentId}:${scope.conversationId}`;
}

/** `muster:{organisationId}:{agentId}:{runId}` */
export function runNamespaceFor(
  scope: Pick<RuntimeScope, "organisationId" | "agentId" | "runId">,
): string {
  return `muster:${scope.organisationId}:${scope.agentId}:${scope.runId}`;
}

export type ParsedThreadId = {
  organisationId: string;
  agentId: string;
  conversationId: string;
};

/**
 * Thread identifiers arrive back from LangGraph configurables. Parsing them
 * lets the checkpoint saver assert that the caller's organisation matches the
 * organisation encoded in the thread before any row is touched.
 */
export function parseThreadId(threadId: string): ParsedThreadId | null {
  const parts = threadId.split(":");
  if (parts.length < 4) return null;
  const [prefix, organisationId, agentId, ...rest] = parts;
  if (prefix !== "muster") return null;
  if (!organisationId || !agentId) return null;
  const conversationId = rest.join(":");
  if (!conversationId) return null;
  return { organisationId, agentId, conversationId };
}

export class CheckpointScopeViolationError extends Error {
  readonly code = "checkpoint_scope_violation";

  constructor(message: string) {
    super(message);
    this.name = "CheckpointScopeViolationError";
  }
}

/**
 * Fail closed when a thread identifier does not belong to the organisation the
 * checkpoint saver was constructed for. This is defence in depth: the SQL
 * predicates are already organisation-scoped.
 */
export function assertThreadBelongsToOrganisation(
  threadId: string,
  organisationId: string,
): ParsedThreadId {
  const parsed = parseThreadId(threadId);
  if (!parsed) {
    throw new CheckpointScopeViolationError(
      "Checkpoint thread identifier is not a Muster tenant thread.",
    );
  }
  if (parsed.organisationId !== organisationId) {
    throw new CheckpointScopeViolationError(
      "Checkpoint thread identifier belongs to a different organisation.",
    );
  }
  return parsed;
}
