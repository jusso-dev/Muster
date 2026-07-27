import { createHash } from "node:crypto";

export interface HashableAuditEvent {
  organisationId: string;
  sequence: number;
  actorId: string;
  actorType: string;
  action: string;
  targetType: string;
  targetId: string;
  previousHash: string;
  metadata: unknown;
  traceId: string;
  createdAt: string;
}

export type AuditChainVerification =
  { valid: true } | { valid: false; brokenAt: number };

export interface AuditLegacyCompatibilityMatch {
  sequence: number;
}

export interface AuditIntegrityReport {
  outcome: "strict-valid" | "legacy-compatible-not-strict" | "invalid";
  strict: AuditChainVerification;
  legacyCompatible: AuditChainVerification;
  legacyApprovalIdOmissions: ReadonlyArray<AuditLegacyCompatibilityMatch>;
  historicalChainRepaired: false;
  attestation: string;
}

type PersistedAuditEvent = HashableAuditEvent & { eventHash: string };
const legacyApprovalIdActions = new Set([
  "integration.action.queued",
  "integration.action.succeeded",
]);

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

export function hashAuditEvent(event: HashableAuditEvent): string {
  return createHash("sha256").update(canonical(event)).digest("hex");
}

export function normaliseAuditMetadata(metadata: unknown): unknown {
  const serialised = JSON.stringify(metadata ?? {});
  if (serialised === undefined) return {};
  return JSON.parse(serialised) as unknown;
}

function isLegacyApprovalIdOmission(event: PersistedAuditEvent): boolean {
  if (
    !legacyApprovalIdActions.has(event.action) ||
    event.metadata === null ||
    typeof event.metadata !== "object" ||
    Array.isArray(event.metadata) ||
    Object.hasOwn(event.metadata, "approvalId")
  ) {
    return false;
  }
  const { eventHash, ...hashable } = event;
  return (
    hashAuditEvent({
      ...hashable,
      metadata: { ...event.metadata, approvalId: undefined },
    }) === eventHash
  );
}

function verify(
  events: ReadonlyArray<PersistedAuditEvent>,
  allowLegacyApprovalIdOmission: boolean,
): {
  verification: AuditChainVerification;
  legacyApprovalIdOmissions: AuditLegacyCompatibilityMatch[];
} {
  const legacyApprovalIdOmissions: AuditLegacyCompatibilityMatch[] = [];
  let previousHash = "0".repeat(64);
  let expectedSequence = 1;
  for (const event of events) {
    if (
      event.sequence !== expectedSequence ||
      event.previousHash !== previousHash
    ) {
      return {
        verification: { valid: false, brokenAt: event.sequence },
        legacyApprovalIdOmissions,
      };
    }
    const { eventHash, ...hashable } = event;
    if (hashAuditEvent(hashable) !== eventHash) {
      if (
        !allowLegacyApprovalIdOmission ||
        !isLegacyApprovalIdOmission(event)
      ) {
        return {
          verification: { valid: false, brokenAt: event.sequence },
          legacyApprovalIdOmissions,
        };
      }
      legacyApprovalIdOmissions.push({ sequence: event.sequence });
    }
    previousHash = eventHash;
    expectedSequence += 1;
  }
  return { verification: { valid: true }, legacyApprovalIdOmissions };
}

export function verifyAuditChain(
  events: ReadonlyArray<PersistedAuditEvent>,
): AuditChainVerification {
  return verify(events, false).verification;
}

export function verifyAuditIntegrity(
  events: ReadonlyArray<PersistedAuditEvent>,
): AuditIntegrityReport {
  const strict = verify(events, false).verification;
  const legacy = verify(events, true);

  if (strict.valid) {
    return {
      outcome: "strict-valid",
      strict,
      legacyCompatible: legacy.verification,
      legacyApprovalIdOmissions: [],
      historicalChainRepaired: false,
      attestation:
        "Strict audit-chain verification passed. No historical event was repaired or changed.",
    };
  }

  if (
    legacy.verification.valid &&
    legacy.legacyApprovalIdOmissions.length > 0
  ) {
    return {
      outcome: "legacy-compatible-not-strict",
      strict,
      legacyCompatible: legacy.verification,
      legacyApprovalIdOmissions: legacy.legacyApprovalIdOmissions,
      historicalChainRepaired: false,
      attestation:
        "A known pre-normalisation undefined approvalId hash is reproducible. Strict verification still fails; this does not repair or change immutable audit history.",
    };
  }

  return {
    outcome: "invalid",
    strict,
    legacyCompatible: legacy.verification,
    legacyApprovalIdOmissions: legacy.legacyApprovalIdOmissions,
    historicalChainRepaired: false,
    attestation:
      "Strict verification failed and no known legacy compatibility reconstruction explains the chain. Preserve immutable history and investigate before attesting recovery.",
  };
}
