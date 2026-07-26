import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { demoOrganisation, demoMode } from "@/lib/demo-data";

const sections = [
  "General",
  "Authentication",
  "Members",
  "Roles",
  "Capabilities",
  "Agents",
  "Workflows",
  "Integrations",
  "Evidence",
  "Retention",
  "Notifications",
  "Audit",
  "API keys",
  "Webhooks",
  "Appearance",
];

export function SettingsView() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Organisation"
        title="Settings"
        description={demoOrganisation.name}
        actions={
          <Button disabled title="Settings persistence is not available yet">
            Save changes
          </Button>
        }
      />
      <div className="grid min-h-0 flex-1 tablet:grid-cols-[13rem_minmax(0,1fr)]">
        <nav className="hidden border-r bg-[var(--color-paper-2)] p-2 tablet:block">
          {sections.map((section, index) => (
            <button
              type="button"
              key={section}
              disabled
              aria-current={index === 0 ? "page" : undefined}
              title={
                index === 0
                  ? "Current section"
                  : `${section} settings are not available yet`
              }
              className={`block h-9 w-full rounded px-2 text-left text-xs disabled:opacity-100 ${index === 0 ? "active-indicator font-semibold" : "text-muted-foreground"}`}
            >
              {section}
            </button>
          ))}
        </nav>
        <div className="scroll-region overflow-y-auto p-4 tablet:p-6">
          <div className="max-w-2xl">
            <h2 className="font-display text-lg font-bold">General</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Workspace identity, region, timezone, and status.
            </p>
            <div className="mt-6 space-y-5">
              {[
                ["Organisation name", demoOrganisation.name],
                ["Slug", demoOrganisation.slug],
                ["Data region", demoMode ? "Australia" : "Local"],
                ["Default timezone", demoMode ? "Australia/Sydney" : "UTC"],
              ].map(([label, value]) => (
                <label key={label} className="block">
                  <span className="mb-1.5 block text-xs font-semibold">
                    {label}
                  </span>
                  <input
                    defaultValue={value}
                    className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none"
                  />
                </label>
              ))}
              <div className="border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">Organisation status</p>
                    <p className="text-xs text-muted-foreground">
                      Active workspaces accept events and agent runs.
                    </p>
                  </div>
                  <Badge className="success-surface text-[var(--color-success)]">
                    Active
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
