import {
  Activity,
  Check,
  CircleAlert,
  ExternalLink,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { OpsShell } from "@/components/ops-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { integrationData } from "@/lib/demo-data";

export function IntegrationView({
  product,
}: {
  product: "bower" | "tawny" | "kelpie" | "sentinel";
}) {
  if (product === "sentinel") return <SentinelView />;
  const data = integrationData[product];
  return (
    <OpsShell>
      <PageHeader
        eyebrow="Configure"
        title={data.name}
        description={data.subtitle}
        actions={
          <>
            <Button
              variant="outline"
              disabled
              title="Connector sync is not available yet"
            >
              <RefreshCw />
              Sync now
            </Button>
            <Button
              variant="outline"
              disabled
              title="Connector configuration is not available yet"
            >
              <Settings2 />
              Configure
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b bg-[var(--color-paper-2)] px-4 py-2">
        <Badge
          className={
            data.status === "healthy"
              ? "success-surface text-[var(--color-success)]"
              : "approval-surface text-[var(--color-warning)]"
          }
        >
          {data.status === "healthy" ? <Check /> : <CircleAlert />}
          {data.status}
        </Badge>
        <Badge className="approval-surface text-[var(--color-warning)]">
          Local mock
        </Badge>
        <span className="text-xs text-muted-foreground">
          Synthetic connector · never represented as production delivery
        </span>
      </div>
      <div className="scroll-region min-h-0 flex-1 overflow-y-auto p-3 tablet:p-5">
        <div className="mx-auto max-w-7xl">
          <section className="grid grid-cols-2 border bg-card tablet:grid-cols-3 wide:grid-cols-6">
            {data.stats.map(([label, value], index) => (
              <div
                key={label}
                className={`p-4 ${index < data.stats.length - 1 ? "border-r" : ""} max-tablet:border-b`}
              >
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {label}
                </p>
                <p className="mt-1 font-display text-xl font-bold">{value}</p>
              </div>
            ))}
          </section>
          <section className="mt-4 border bg-card">
            <div className="flex items-center justify-between border-b px-3 py-2.5">
              <div>
                <h2 className="font-display text-sm font-bold">
                  {product === "bower"
                    ? "Collector fleet"
                    : product === "tawny"
                      ? "Endpoint inventory"
                      : "Authoritative cases"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  Last synchronised 42 seconds ago
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled
                title="Delivery logs are not available yet"
              >
                Delivery log
                <ExternalLink />
              </Button>
            </div>
            <div className="scroll-region overflow-x-auto">
              <table className="w-full min-w-[52rem] text-left text-xs">
                <tbody>
                  {data.rows.map((row) => (
                    <tr
                      key={row[0]}
                      className="hover-row border-b last:border-0"
                    >
                      {row.map((cell, index) => (
                        <td
                          key={`${row[0]}-${index}`}
                          className={`h-13 px-3 ${index === 0 ? "mono font-semibold text-foreground" : "text-muted-foreground"}`}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {product === "bower" && (
            <div className="mt-4 flex items-start gap-3 border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-3 text-xs">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]" />
              <p>
                <strong>Delivery posture limitation:</strong> collector
                heartbeat and queue state do not prove that events are queryable
                at the downstream destination. Canary evidence remains the
                stronger verification.
              </p>
            </div>
          )}
          {product === "tawny" && (
            <div className="mt-4 flex items-start gap-3 border bg-card p-3 text-xs">
              <Activity className="mt-0.5 size-4 shrink-0 text-[var(--color-accent)]" />
              <p>
                <strong>Connector capability:</strong> read-only hunts accept
                API tokens. The inspected Tawny build restricts response-action
                creation to authenticated web administrators; local mocks
                clearly label this contract gap.
              </p>
            </div>
          )}
        </div>
      </div>
    </OpsShell>
  );
}

function SentinelView() {
  return (
    <OpsShell>
      <PageHeader
        eyebrow="Configure"
        title="Microsoft Sentinel"
        description="Incidents, bounded Log Analytics query, and analytics-rule read"
        actions={
          <Button
            variant="outline"
            disabled
            title="Connector configuration is not available yet"
          >
            <Settings2 />
            Configure
          </Button>
        }
      />
      <div className="grid flex-1 place-items-center p-8">
        <div className="max-w-md border bg-card p-5">
          <Badge className="approval-surface text-[var(--color-warning)]">
            Local mock
          </Badge>
          <h2 className="mt-3 font-display text-lg font-bold">
            Sentinel workspace connected
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Queries are range-limited, result-capped, capability-checked, and
            audited. Destructive actions are disabled in the MVP.
          </p>
        </div>
      </div>
    </OpsShell>
  );
}
