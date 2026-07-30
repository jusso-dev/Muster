"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { ErrorState } from "@/components/os/error-state";
import { SkeletonRows } from "@/components/os/skeleton";
import { Badge } from "@/components/ui/badge";
import { apiGet } from "@/lib/api/client";
import { relativeTime } from "@/lib/utils";
import type {
  AgentProfile,
  AgentRoomProfile,
  AgentToolProfile,
} from "@/lib/agent-profile-domain";

export type AgentProfileTab = "tools" | "rooms" | "permissions";

function useAgentProfile(agentId: string) {
  return useQuery({
    queryKey: ["agents", agentId, "profile"],
    queryFn: async () => {
      const res = await apiGet<AgentProfile>(
        `/api/v1/agents/${encodeURIComponent(agentId)}/profile`,
      );
      return res.data;
    },
    staleTime: 30_000,
  });
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-card">
      <header className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
      </header>
      {children}
    </section>
  );
}

function ToolRow({ tool }: { tool: AgentToolProfile }) {
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 last:border-b-0">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-sm">{tool.name}</span>
        <span className="block truncate text-sm text-muted-foreground">
          {tool.registered
            ? `Requires ${tool.capability}`
            : "Not implemented by the runtime registry"}
        </span>
      </span>
      {tool.mutation === true ? (
        <Badge className="bg-[var(--color-warning-soft)] text-[var(--color-warning)]">
          writes
        </Badge>
      ) : tool.mutation === false ? (
        <Badge className="bg-muted text-muted-foreground">read only</Badge>
      ) : null}
      {tool.approvalAction ? (
        <Badge className="bg-muted font-mono text-muted-foreground">
          {tool.approvalAction}
        </Badge>
      ) : null}
      {!tool.registered ? (
        <Badge className="bg-[var(--color-error-soft)] text-[var(--color-error)]">
          unregistered
        </Badge>
      ) : null}
      <span className="w-28 text-right text-xs text-muted-foreground">
        {tool.callCount} calls
      </span>
      <span className="w-28 text-right text-xs text-muted-foreground">
        {tool.lastUsedAt ? relativeTime(tool.lastUsedAt) : "never used"}
      </span>
    </li>
  );
}

function RoomRow({ room }: { room: AgentRoomProfile }) {
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 last:border-b-0">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {room.displayName}
        </span>
        <span className="block truncate font-mono text-xs text-muted-foreground">
          {room.slug}
        </span>
      </span>
      <Badge className="bg-muted text-muted-foreground">{room.roomType}</Badge>
      {room.allowed ? (
        <Badge className="bg-muted text-muted-foreground">allowed</Badge>
      ) : (
        <Badge className="bg-[var(--color-warning-soft)] text-[var(--color-warning)]">
          member, not allow-listed
        </Badge>
      )}
      {room.member ? null : (
        <Badge className="bg-muted text-muted-foreground">no membership</Badge>
      )}
    </li>
  );
}

function CapabilityList({
  items,
  empty,
  tone,
}: {
  items: string[];
  empty: string;
  tone?: "error";
}) {
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <p className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Badge
          key={item}
          className={
            tone === "error"
              ? "bg-[var(--color-error-soft)] font-mono text-[var(--color-error)]"
              : "bg-muted font-mono text-muted-foreground"
          }
        >
          {item}
        </Badge>
      ))}
    </p>
  );
}

/**
 * Read-only governance detail for one agent. Grants and allow-lists are
 * server-controlled; this shows what is configured and where configuration
 * and reality disagree.
 */
export function AgentProfilePanel({
  agentId,
  tab,
}: {
  agentId: string;
  tab: AgentProfileTab;
}) {
  const profile = useAgentProfile(agentId);

  if (profile.isError)
    return (
      <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
    );
  if (!profile.data) return <SkeletonRows rows={5} />;
  const data = profile.data;

  if (tab === "tools") {
    return (
      <Section
        title="Tools"
        hint="Declared tool envelope, joined with what this agent has actually called. Tools are authorised per run; nothing here changes the envelope."
      >
        {data.tools.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            No tools are declared for this agent and none have been called.
          </p>
        ) : (
          <ul>
            {data.tools.map((tool) => (
              <ToolRow key={tool.name} tool={tool} />
            ))}
          </ul>
        )}
      </Section>
    );
  }

  if (tab === "rooms") {
    return (
      <div className="flex flex-col gap-5">
        <Section
          title="Rooms"
          hint="Where this agent may work, and where it actually holds membership."
        >
          {data.rooms.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              No rooms are allow-listed and no membership exists.
            </p>
          ) : (
            <ul>
              {data.rooms.map((room) => (
                <RoomRow key={room.id} room={room} />
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Slack exposure"
          hint="Slack is where people talk to this agent. Exposure is granted per installation."
        >
          {data.slackExposures.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              This agent is not exposed in any Slack installation.
            </p>
          ) : (
            <ul>
              {data.slackExposures.map((exposure) => (
                <li
                  key={exposure.installationId}
                  className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 text-sm">
                    {exposure.teamName ?? exposure.installationId}
                  </span>
                  {exposure.isDefault ? (
                    <Badge className="bg-muted text-muted-foreground">
                      default agent
                    </Badge>
                  ) : null}
                  <Badge
                    className={
                      exposure.enabled
                        ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {exposure.enabled ? "enabled" : "disabled"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    );
  }

  const { permissions } = data;
  return (
    <div className="flex flex-col gap-5">
      {permissions.missing.length > 0 ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-[var(--color-error)]/40 bg-[var(--color-error-soft)] p-3"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-[var(--color-error)]"
            aria-hidden
          />
          <div>
            <p className="text-sm font-semibold text-[var(--color-error)]">
              Declared requirements this agent does not hold
            </p>
            <p className="mt-1 text-sm">
              A run needing one of these fails with a capability error. Grant
              them or narrow the definition.
            </p>
            <div className="mt-2">
              <CapabilityList
                items={permissions.missing}
                empty=""
                tone="error"
              />
            </div>
          </div>
        </div>
      ) : null}

      <Section
        title="Required"
        hint="Capabilities the agent definition declares it needs."
      >
        <div className="p-3">
          <CapabilityList
            items={permissions.required}
            empty="The definition declares no capability requirements."
          />
        </div>
      </Section>

      <Section
        title="Granted"
        hint="Capabilities actually assigned to this agent actor. Server-enforced on every request."
      >
        <div className="p-3">
          <CapabilityList
            items={permissions.granted}
            empty="This agent holds no capabilities."
          />
        </div>
      </Section>

      {permissions.surplus.length > 0 ? (
        <Section
          title="Granted beyond the declaration"
          hint="Held but not declared as required. Worth reviewing against least privilege."
        >
          <div className="p-3">
            <CapabilityList items={permissions.surplus} empty="" />
          </div>
        </Section>
      ) : null}

      {permissions.unknown.length > 0 ? (
        <Section
          title="Unrecognised requirements"
          hint="Declared in the definition but not a capability this build knows about."
        >
          <div className="p-3">
            <CapabilityList items={permissions.unknown} empty="" tone="error" />
          </div>
        </Section>
      ) : null}

      <Section
        title="Execution limits"
        hint="Hard ceilings applied to every run by the gateway."
      >
        <dl className="grid gap-3 p-3 text-sm tablet:grid-cols-3">
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Runtime</dt>
            <dd className="mt-0.5">
              {permissions.budgets.maximumRuntimeSeconds}s
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Tokens</dt>
            <dd className="mt-0.5">
              {permissions.budgets.maximumTokenBudget.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Cost</dt>
            <dd className="mt-0.5">
              {(permissions.budgets.maximumCostCents / 100).toFixed(2)}
            </dd>
          </div>
        </dl>
      </Section>
    </div>
  );
}
