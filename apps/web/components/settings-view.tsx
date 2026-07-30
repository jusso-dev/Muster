"use client";

import Link from "next/link";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import { ErrorState } from "@/components/os/error-state";
import { SkeletonRows } from "@/components/os/skeleton";
import { PageBody } from "@/components/os/page-body";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { useSession } from "@/lib/queries/hooks";

/**
 * Settings is navigation plus read-only organisation facts. Every entry here
 * routes to a surface that exists; there is no write API for workspace
 * identity yet, so those fields are shown as values rather than as inputs that
 * silently discard edits.
 */
const sections: Array<{ label: string; href: string; detail: string }> = [
  {
    label: "Members",
    href: "/teams",
    detail: "Humans and pack agents in the governed directory",
  },
  {
    label: "Capabilities",
    href: "/capabilities",
    detail: "Published packs and the live grant inventory",
  },
  {
    label: "Agents",
    href: "/agents",
    detail: "Runtime, readiness, and kill switches",
  },
  {
    label: "Approvals",
    href: "/approvals",
    detail: "Governance inbox for pending decisions",
  },
  {
    label: "Integrations",
    href: "/integrations",
    detail: "Connector and platform health",
  },
  {
    label: "Governed connectors",
    href: "/integrations/connectors",
    detail: "Credentials and connector administration",
  },
  {
    label: "Slack",
    href: "/settings/slack",
    detail: "Workspace install, identity mapping, agent exposure",
  },
  {
    label: "Reaction packs",
    href: "/settings/reaction-packs",
    detail: "Pack catalogue, imports, and revision approval",
  },
  {
    label: "Alfie research",
    href: "/settings/alfie-research",
    detail: "Research feeds and watchlists",
  },
  {
    label: "Parker reports",
    href: "/settings/parker-reports",
    detail: "Report schedules and delivery",
  },
  {
    label: "Audit",
    href: "/audit",
    detail: "Organisation-scoped activity feed",
  },
  {
    label: "Missions",
    href: "/missions",
    detail: "Governed mission definitions and runs",
  },
];

export function SettingsView() {
  const session = useSession();
  const organisation = session.data?.organisation;

  const facts: Array<[string, string]> = organisation
    ? [
        ["Organisation name", organisation.name],
        ["Slug", organisation.slug],
        ["Data region", organisation.dataRegion],
        ["Default timezone", organisation.timezone],
      ]
    : [];

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Configure"
        title="Settings"
        description={
          organisation?.name ??
          (session.isLoading ? "Loading…" : "Organisation settings")
        }
        actions={
          <Link
            href="/integrations/connectors"
            className={buttonVariants({ variant: "default" })}
          >
            Governed connectors
          </Link>
        }
      />
      <PageBody>
        {session.isError ? (
          <ErrorState
            error={session.error}
            onRetry={() => {
              void session.refetch();
            }}
          />
        ) : null}

        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Workspace</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Identity, region, timezone, and status. Read-only: workspace
            identity is set at bootstrap and has no governed write API.
          </p>
          {session.isLoading && facts.length === 0 ? (
            <div className="mt-4">
              <SkeletonRows rows={4} />
            </div>
          ) : (
            <dl className="mt-4 grid gap-3 text-sm tablet:grid-cols-2">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs uppercase text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="mt-0.5 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {organisation ? (
            <div className="mt-4 flex items-center justify-between gap-2 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-semibold">Organisation status</p>
                <p className="text-sm text-muted-foreground">
                  Active workspaces accept events and agent runs.
                </p>
              </div>
              <Badge
                className={
                  organisation.status === "active"
                    ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                    : "bg-muted text-muted-foreground"
                }
              >
                {organisation.status}
              </Badge>
            </div>
          ) : null}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Administration</h2>
          <div className="grid gap-2 tablet:grid-cols-2">
            {sections.map((section) => (
              <Link
                key={section.href}
                href={section.href}
                className="rounded-md border border-border bg-card p-3 hover:border-[var(--color-accent)]"
              >
                <p className="text-sm font-medium">{section.label}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {section.detail}
                </p>
              </Link>
            ))}
          </div>
        </section>

        <p className="text-sm text-muted-foreground">
          Capability grants, retention, and connector credentials are
          server-controlled. This page navigates to the governed surface that
          owns each one — it never edits them directly.
        </p>
      </PageBody>
    </CompanyOsShell>
  );
}
