import type { OpsEnv } from "../env.ts";
import type { KelpieCase, KelpieClient } from "../clients/kelpie.ts";

export type CaseAttention = {
  id: string;
  caseNumber: string | null;
  title: string | null;
  status: string | null;
  severity: string | null;
  openedAt: string | null;
  ageHours: number | null;
  assigneeId: string | null;
  slaState: string | null;
  needsAttention: boolean;
  reasons: string[];
  source: "kelpie";
};

function openedAt(c: KelpieCase): string | null {
  return c.openedAt ?? c.opened_at ?? null;
}

function caseNumber(c: KelpieCase): string | null {
  return c.caseNumber ?? c.case_number ?? null;
}

function isOpen(status: string | null | undefined): boolean {
  if (!status) return true;
  const s = status.toLowerCase();
  return s !== "closed" && s !== "resolved" && s !== "cancelled";
}

export async function getCaseQueue(
  kelpie: KelpieClient,
  env: Pick<OpsEnv, "caseAgingHours">,
  now = new Date(),
): Promise<{
  source: "kelpie";
  generatedAt: string;
  openCount: number;
  agingCount: number;
  unassignedCount: number;
  cases: CaseAttention[];
  mttrHint: string;
}> {
  // Prefer open filter if API supports it; fall back to client filter.
  let rows: KelpieCase[] = [];
  try {
    rows = await kelpie.listCases({ status: "open", limit: 100 });
  } catch {
    rows = await kelpie.listCases({ limit: 100 });
  }
  const open = rows.filter((c) => isOpen(c.status));

  const cases: CaseAttention[] = open.map((c) => {
    const opened = openedAt(c);
    const ageHours =
      opened && !Number.isNaN(Date.parse(opened))
        ? Math.round((now.getTime() - Date.parse(opened)) / 3_600_000)
        : null;
    const assigneeId = c.assigneeId ?? c.assignee_id ?? null;
    const slaState = c.slaState ?? c.sla_state ?? null;
    const reasons: string[] = [];
    if (ageHours !== null && ageHours >= env.caseAgingHours) {
      reasons.push(`open ${ageHours}h (>= ${env.caseAgingHours}h)`);
    }
    if (!assigneeId) reasons.push("unassigned");
    if (slaState && /breach|overdue|violat/i.test(slaState)) {
      reasons.push(`sla:${slaState}`);
    }
    if ((c.severity ?? "").toLowerCase() === "critical") {
      reasons.push("severity:critical");
    }
    return {
      id: c.id,
      caseNumber: caseNumber(c),
      title: c.title ?? null,
      status: c.status ?? null,
      severity: c.severity ?? null,
      openedAt: opened,
      ageHours,
      assigneeId,
      slaState,
      needsAttention: reasons.length > 0,
      reasons,
      source: "kelpie",
    };
  });

  cases.sort((a, b) => {
    if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
    return (b.ageHours ?? 0) - (a.ageHours ?? 0);
  });

  const closed = rows.filter((c) => !isOpen(c.status) && (c.closedAt ?? c.closed_at));
  let mttrHint =
    "MTTR not computed (need closed cases with opened_at/closed_at in the sample).";
  if (closed.length > 0) {
    const hours: number[] = [];
    for (const c of closed) {
      const o = openedAt(c);
      const cl = c.closedAt ?? c.closed_at;
      if (!o || !cl) continue;
      const a = Date.parse(o);
      const b = Date.parse(cl);
      if (Number.isNaN(a) || Number.isNaN(b) || b < a) continue;
      hours.push((b - a) / 3_600_000);
    }
    if (hours.length > 0) {
      const avg = hours.reduce((s, n) => s + n, 0) / hours.length;
      mttrHint = `Approx MTTR on ${hours.length} closed case(s) in sample: ${avg.toFixed(1)}h (not a full SLA engine).`;
    }
  }

  return {
    source: "kelpie",
    generatedAt: now.toISOString(),
    openCount: cases.length,
    agingCount: cases.filter((c) => (c.ageHours ?? 0) >= env.caseAgingHours).length,
    unassignedCount: cases.filter((c) => !c.assigneeId).length,
    cases,
    mttrHint,
  };
}
