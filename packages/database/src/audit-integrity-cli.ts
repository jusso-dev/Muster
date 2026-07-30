import { z } from "zod";
import type { AuditIntegrityReport } from "@muster/audit";

export const RUNBOOK = "docs/operations/audit-chain-verification.md";

/**
 * 64/69 are sysexits EX_USAGE/EX_UNAVAILABLE: a missing organisation id or an
 * unreachable database must not raise the same alarm as a chain that failed
 * verification.
 */
export const auditIntegrityExitCodes = {
  "strict-valid": 0,
  invalid: 1,
  "legacy-compatible-not-strict": 2,
  usage: 64,
  unavailable: 69,
} as const;

export interface AuditOrganisationChoice {
  id: string;
  slug: string | null;
  name: string | null;
}

function usage(
  reason: string,
  known: ReadonlyArray<AuditOrganisationChoice>,
): string {
  const lines = [
    reason,
    "",
    "Usage:",
    "  MUSTER_AUDIT_ORGANISATION_ID=<uuid> pnpm db:verify-audit",
    "  pnpm db:verify-audit --organisation=<uuid>",
    "",
  ];
  if (known.length === 0) {
    lines.push(
      "No organisations could be listed from this database. Check DATABASE_URL.",
    );
  } else {
    lines.push("Organisations in this database:");
    for (const choice of known) {
      lines.push(
        `  ${choice.id}  ${choice.slug ?? choice.name ?? ""}`.trimEnd(),
      );
    }
  }
  lines.push("", `Runbook: ${RUNBOOK}`);
  return lines.join("\n");
}

export function resolveAuditOrganisationId(
  candidate: string | undefined,
  known: ReadonlyArray<AuditOrganisationChoice> = [],
): { organisationId: string } | { usage: string } {
  const trimmed = candidate?.trim();
  if (!trimmed) {
    return {
      usage: usage(
        "MUSTER_AUDIT_ORGANISATION_ID is not set and --organisation was not passed.",
        known,
      ),
    };
  }
  if (!z.string().uuid().safeParse(trimmed).success) {
    return {
      usage: usage(`"${trimmed}" is not a UUID organisation id.`, known),
    };
  }
  return { organisationId: trimmed };
}

/**
 * Operator-readable interpretation of the machine-readable report. Every branch
 * states that immutable history stays untouched: the only safe response to a
 * hash mismatch is investigation, never a rewrite.
 */
export function describeAuditIntegrity(report: AuditIntegrityReport): string {
  const brokenAt = report.strict.valid ? undefined : report.strict.brokenAt;

  if (report.outcome === "strict-valid") {
    return `Strict verification passed. The chain is intact and nothing was changed. Runbook: ${RUNBOOK}`;
  }

  if (report.outcome === "legacy-compatible-not-strict") {
    const sequences = report.legacyApprovalIdOmissions
      .map((match) => match.sequence)
      .join(", ");
    return [
      `Strict verification failed at sequence ${brokenAt}.`,
      `Every failing event is a known pre-normalisation approvalId omission (sequence ${sequences}); its stored hash is reproducible only under the legacy compatibility path.`,
      "This is expected on workspaces that recorded integration actions before metadata normalisation. The chain still links, and no event was repaired or rewritten.",
      `Do not mutate any audit row. Record this outcome against the runbook: ${RUNBOOK}`,
    ].join("\n");
  }

  return [
    `Strict verification failed at sequence ${brokenAt} and no known legacy reconstruction explains it.`,
    "Treat this as a potential tampering or corruption incident. Preserve the rows exactly as stored.",
    `Runbook: ${RUNBOOK}`,
  ].join("\n");
}
