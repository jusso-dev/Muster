import { redactUntrusted } from "@muster/integrations";

const MAX_RECORDS = 25;
const MAX_STRING_LENGTH = 4_000;

function truncateStrings(value: unknown): unknown {
  if (typeof value === "string")
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]`
      : value;
  if (Array.isArray(value)) return value.map(truncateStrings);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        truncateStrings(entry),
      ]),
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
 * Bounds and redacts Kelpie query results before they can reach a prompt.
 * Every record is untrusted external evidence: it is never an instruction,
 * and secrets/oversized strings never survive this step.
 */
export function classifyKelpieRecords(
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

export function classifyKelpieCase(record: unknown): ClassifiedCase {
  return {
    classification: "untrusted_evidence",
    record: truncateStrings(redactUntrusted(record)),
  };
}
