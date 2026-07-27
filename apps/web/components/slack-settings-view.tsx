"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

type SlackInstallation = {
  id: string;
  teamId: string;
  teamName: string | null;
  status: string;
  lastHealthAt: string | null;
  lastDeliveryAt: string | null;
  lastError: string | null;
};

export function SlackSettingsView() {
  const [installations, setInstallations] = useState<SlackInstallation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/slack/health", { cache: "no-store" });
      const payload = (await response.json()) as { data?: SlackInstallation[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Slack health check failed");
      setInstallations(payload.data ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Slack health check failed");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const reconnect = async () => {
    const response = await fetch("/api/v1/slack/install", { cache: "no-store" });
    const payload = (await response.json()) as { data?: { authorizationUrl?: string }; error?: string };
    if (!response.ok || !payload.data?.authorizationUrl) {
      setError(payload.error ?? "Could not start Slack OAuth");
      return;
    }
    window.location.assign(payload.data.authorizationUrl);
  };

  const revoke = async (installationId: string) => {
    const response = await fetch(
      `/api/v1/slack/install?installationId=${encodeURIComponent(installationId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) setError("Could not revoke Slack installation");
    await load();
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Integrations"
        title="Slack agent harness"
        description="Organisation-bound Slack identity, exposure, delivery, and reconnect health."
        actions={<Button onClick={() => void reconnect()}>Connect or reconnect Slack</Button>}
      />
      <section className="rounded-xl border border-border bg-card p-5">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {loading ? <p className="text-sm text-muted-foreground">Checking Slack health…</p> : null}
        {!loading && installations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Slack workspace is connected.</p>
        ) : null}
        <div className="space-y-3">
          {installations.map((installation) => (
            <div key={installation.id} className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
              <div>
                <p className="font-medium">{installation.teamName ?? installation.teamId}</p>
                <p className="text-sm text-muted-foreground">
                  {installation.status} · health {installation.lastHealthAt ?? "not checked"} · delivery {installation.lastDeliveryAt ?? "none"}
                </p>
                {installation.lastError ? <p className="text-sm text-destructive">{installation.lastError}</p> : null}
              </div>
              <Button variant="outline" onClick={() => void revoke(installation.id)}>Revoke</Button>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
