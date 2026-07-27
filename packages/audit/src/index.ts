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

export function verifyAuditChain(
  events: ReadonlyArray<HashableAuditEvent & { eventHash: string }>,
): { valid: boolean; brokenAt?: number } {
  let previousHash = "0".repeat(64);
  for (const event of events) {
    if (event.previousHash !== previousHash) {
      return { valid: false, brokenAt: event.sequence };
    }
    const { eventHash, ...hashable } = event;
    if (hashAuditEvent(hashable) !== eventHash) {
      return { valid: false, brokenAt: event.sequence };
    }
    previousHash = eventHash;
  }
  return { valid: true };
}
