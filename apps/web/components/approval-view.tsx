import { Check, Clock3, ShieldCheck, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { SeverityBadge } from "@/components/severity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ApprovalView() {
  return <AppShell><PageHeader eyebrow="Operations" title="Approvals" description="State-changing security actions requiring accountable human decisions" /><div className="scroll-region min-h-0 flex-1 overflow-y-auto p-3 tablet:p-5"><div className="mx-auto max-w-5xl space-y-3">{[["critical","Isolate endpoint WS-1042","Triage Agent","Stops network activity on a production finance endpoint.","22 min"],["high","Promote INV-2026-0178 to Kelpie","Maya Chen","Creates a formal critical case and applies the compromised endpoint playbook.","41 min"]].map(([severity,title,actor,risk,expiry]) => <article key={title} className="border border-[var(--color-warning)] bg-card"><div className="flex flex-wrap items-center gap-2 border-b bg-[var(--color-warning-soft)] p-3"><SeverityBadge severity={severity as "critical" | "high"} /><h2 className="flex-1 font-display text-sm font-bold">{title}</h2><Badge className="approval-surface text-[var(--color-warning)]"><Clock3 />Expires in {expiry}</Badge></div><div className="grid gap-4 p-4 tablet:grid-cols-[1fr_16rem]"><div><p className="text-[10px] font-bold uppercase text-muted-foreground">Risk summary</p><p className="mt-1 text-sm leading-6">{risk}</p><p className="mt-3 text-xs text-muted-foreground">Requested by <strong className="text-foreground">{actor}</strong> · requires <code>workflows.approve</code></p></div><div className="flex items-end gap-2 tablet:justify-end"><Button><Check />Approve</Button><Button variant="outline"><X />Reject</Button></div></div></article>)}</div></div></AppShell>;
}
