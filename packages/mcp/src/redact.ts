import { redactUntrusted } from "@muster/integrations";

const MAX_RECORDS = 25;
const MAX_STRING_LENGTH = 4_000;
const MAX_DEPTH = 6;
const MAX_CHILDREN = 100;

/**
 * Bounds both depth and breadth in addition to string length: an evidence
 * record is untrusted external data, so nesting and fan-out are bounded the
 * same way size is, rather than trusting upstream shape.
 */
function truncateStrings(value: unknown, depth = 0): unknown {
  if (typeof value === "string")
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]`
      : value;
  if (depth >= MAX_DEPTH) return "[depth truncated]";
  if (Array.isArray(value))
    return value
      .slice(0, MAX_CHILDREN)
      .map((item) => truncateStrings(item, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_CHILDREN)
        .map(([key, entry]) => [key, truncateStrings(entry, depth + 1)]),
    );
  return value;
}

export interface ClassifiedRecords {
  classification: "untrusted_evidence";
  truncated: boolean;
  count: number;
  records: unknown[];
}

/**
 * Bounds and redacts connector query results before they can reach a prompt.
 * Every record is untrusted external evidence: it is never an instruction,
 * and secrets/oversized strings never survive this step.
 */
export function classifyEvidenceRecords(
  records: unknown[],
  limit: number,
): ClassifiedRecords {
  const bounded = records.slice(0, Math.min(limit, MAX_RECORDS));
  return {
    classification: "untrusted_evidence",
    truncated: records.length > bounded.length,
    count: bounded.length,
    records: bounded.map((record) => truncateStrings(redactUntrusted(record))),
  };
}

export interface ClassifiedCase {
  classification: "untrusted_evidence";
  record: unknown;
}

export function classifyEvidenceCase(record: unknown): ClassifiedCase {
  return {
    classification: "untrusted_evidence",
    record: truncateStrings(redactUntrusted(record)),
  };
}

/** @deprecated Prefer classifyEvidenceRecords */
export const classifyKelpieRecords = classifyEvidenceRecords;
/** @deprecated Prefer classifyEvidenceCase */
export const classifyKelpieCase = classifyEvidenceCase;
