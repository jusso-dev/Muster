"use client";

import Link from "next/link";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

type Installation = {
  id: string;
  teamId: string;
  teamName: string | null;
  scopes: unknown;
  status: string;
  installedAt: string;
  lastHealthAt: string | null;
  lastDeliveryAt: string | null;
  lastError: string | null;
};

type Actor = { id: string; displayName: string };
type Agent = { id: string; name: string };
type Identity = {
  id: string;
  installationId: string;
  slackUserId: string;
  actorId: string;
  actorName: string;
  status: string;
  createdAt: string;
};
type Exposure = {
  id: string;
  installationId: string;
  agentId: string;
  agentName: string;
  enabled: boolean;
  isDefault: boolean;
  allowedChannelIds: unknown;
  allowDirectMessages: boolean;
  allowThreadContext: boolean;
  updatedAt: string;
};
type Delivery = {
  id: string;
  installationId: string;
  runId: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  updatedAt: string;
};
type SlackSettings = {
  installations: Installation[];
  actors: Actor[];
  agents: Agent[];
  identities: Identity[];
  exposures: Exposure[];
  deliveries: Delivery[];
};

const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Not recorded";

const channels = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

export function SlackSettingsView() {
  const [settings, setSettings] = useState<SlackSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [exposureEnabled, setExposureEnabled] = useState(true);
  const [exposureDefault, setExposureDefault] = useState(false);
  const [revokeCandidate, setRevokeCandidate] = useState<Installation | null>(
    null,
  );
  const hasLoaded = useRef(false);
  const reconnectButton = useRef<HTMLButtonElement>(null);
  const revokeDialog = useRef<HTMLDivElement>(null);
  const revokeCancelButton = useRef<HTMLButtonElement>(null);
  const revokeReturnFocus = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    setLoading(!hasLoaded.current);
    try {
      const response = await fetch("/api/v1/slack/settings", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        data?: SlackSettings;
        detail?: string;
      };
      if (!response.ok || !payload.data)
        throw new Error(
          payload.detail ?? "Could not load Slack administration settings.",
        );
      setSettings(payload.data);
      setError(null);
      hasLoaded.current = true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load Slack administration settings.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (!revokeCandidate) return;
    const frame = requestAnimationFrame(() =>
      revokeCancelButton.current?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [revokeCandidate]);

  const activeInstallations = useMemo(
    () =>
      settings?.installations.filter(
        (installation) => installation.status === "active",
      ) ?? [],
    [settings],
  );

  const reconnect = async () => {
    setBusy("reconnect");
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/v1/slack/install", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        data?: { authorizationUrl?: string };
        detail?: string;
      };
      if (!response.ok || !payload.data?.authorizationUrl)
        throw new Error(payload.detail ?? "Could not start Slack OAuth.");
      window.location.assign(payload.data.authorizationUrl);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not start Slack OAuth.",
      );
    } finally {
      setBusy(null);
    }
  };

  const refreshHealth = async () => {
    setBusy("health");
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/v1/slack/health", {
        cache: "no-store",
      });
      const payload = (await response.json()) as { detail?: string };
      if (!response.ok)
        throw new Error(payload.detail ?? "Slack health refresh failed.");
      await load();
      setNotice("Slack diagnostics refreshed.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Slack health refresh failed.",
      );
    } finally {
      setBusy(null);
    }
  };

  const request = async (
    url: string,
    method: "POST" | "PUT",
    body: unknown,
  ) => {
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { detail?: string };
    if (!response.ok)
      throw new Error(payload.detail ?? "Slack administration update failed.");
  };

  const saveIdentity = async (form: HTMLFormElement) => {
    const values = new FormData(form);
    setBusy("identity");
    setNotice(null);
    setError(null);
    try {
      await request("/api/v1/slack/identities", "POST", {
        installationId: values.get("installationId"),
        slackUserId: values.get("slackUserId"),
        actorId: values.get("actorId"),
      });
      form.reset();
      await load();
      setNotice("Slack user mapping saved.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save Slack user mapping.",
      );
    } finally {
      setBusy(null);
    }
  };

  const saveExposure = async (form: HTMLFormElement) => {
    const values = new FormData(form);
    const allowedChannelIds = String(values.get("allowedChannelIds") ?? "")
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean);
    const enabled = values.get("enabled") === "on";
    setBusy("exposure");
    setNotice(null);
    setError(null);
    try {
      await request("/api/v1/slack/exposures", "PUT", {
        installationId: values.get("installationId"),
        agentId: values.get("agentId"),
        enabled,
        isDefault: enabled && values.get("isDefault") === "on",
        allowedChannelIds,
        allowDirectMessages: values.get("allowDirectMessages") === "on",
        allowThreadContext: values.get("allowThreadContext") === "on",
      });
      await load();
      setNotice("Agent exposure policy saved.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save agent exposure policy.",
      );
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    if (!revokeCandidate) return;
    setBusy("revoke");
    setNotice(null);
    setError(null);
    let completed = false;
    try {
      const response = await fetch(
        `/api/v1/slack/install?installationId=${encodeURIComponent(revokeCandidate.id)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as { detail?: string };
      if (!response.ok)
        throw new Error(
          payload.detail ?? "Could not revoke Slack installation.",
        );
      setRevokeCandidate(null);
      await load();
      setNotice("Slack installation revoked. Existing tokens were replaced.");
      completed = true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not revoke Slack installation.",
      );
    } finally {
      setBusy(null);
      if (completed)
        requestAnimationFrame(() => reconnectButton.current?.focus());
    }
  };

  const closeRevoke = () => {
    const returnTarget = revokeReturnFocus.current;
    setRevokeCandidate(null);
    requestAnimationFrame(() => {
      if (returnTarget?.isConnected) returnTarget.focus();
      else reconnectButton.current?.focus();
    });
  };

  const handleRevokeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && busy === null) {
      event.preventDefault();
      closeRevoke();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      revokeDialog.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Integrations"
        title="Slack agent harness"
        description="Organisation-scoped Slack identities, agent exposure, delivery health, and reconnect controls."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void refreshHealth()}
              disabled={busy !== null}
              state={busy === "health" ? "loading" : "default"}
            >
              Refresh diagnostics
            </Button>
            <Button
              ref={reconnectButton}
              onClick={() => void reconnect()}
              disabled={busy !== null}
              state={busy === "reconnect" ? "loading" : "default"}
            >
              {activeInstallations.length > 0
                ? "Reconnect Slack"
                : "Connect Slack"}
            </Button>
          </div>
        }
      />

      <div
        className="scroll-region min-h-0 flex-1 space-y-5 overflow-y-auto p-4 tablet:p-6"
        aria-busy={loading}
      >
        {error ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 border border-[var(--color-error)] bg-[var(--color-error-soft)] p-3 text-sm text-[var(--color-error)]"
          >
            <p>{error}</p>
            {!settings ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void load()}
                disabled={loading}
              >
                Retry loading
              </Button>
            ) : null}
          </div>
        ) : null}
        {notice ? (
          <p
            role="status"
            className="border border-[var(--color-success)] bg-[var(--color-success-soft)] p-3 text-sm text-[var(--color-success)]"
          >
            {notice}
          </p>
        ) : null}
        {loading ? (
          <p
            role="status"
            className="border bg-card p-4 text-sm text-muted-foreground"
          >
            Loading Slack administration…
          </p>
        ) : null}

        {!loading && settings ? (
          <>
            <section
              className="border bg-card p-4 tablet:p-5"
              aria-labelledby="slack-installations-heading"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2
                    id="slack-installations-heading"
                    className="font-display text-lg font-bold"
                  >
                    Workspace connections
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Tokens stay encrypted; this view only shows redacted
                    operator diagnostics.
                  </p>
                </div>
              </div>
              {settings.installations.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  No Slack workspace is connected. Connect Slack to begin a
                  governed installation.
                </p>
              ) : null}
              <div className="mt-4 space-y-3">
                {settings.installations.map((installation) => (
                  <article
                    key={installation.id}
                    className="flex flex-wrap items-start justify-between gap-4 border p-4"
                  >
                    <div className="min-w-0 space-y-1">
                      <h3 className="font-semibold">
                        {installation.teamName ?? installation.teamId}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {installation.status} · installed{" "}
                        {date(installation.installedAt)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Health: {date(installation.lastHealthAt)} · latest
                        delivery: {date(installation.lastDeliveryAt)}
                      </p>
                      <p className="break-words text-sm text-muted-foreground">
                        Scopes:{" "}
                        {channels(installation.scopes).join(", ") ||
                          "Not recorded"}
                      </p>
                      {installation.lastError ? (
                        <p
                          role="alert"
                          className="break-words text-sm text-[var(--color-error)]"
                        >
                          {installation.lastError}
                        </p>
                      ) : null}
                    </div>
                    {installation.status === "active" ? (
                      <Button
                        variant="destructive"
                        onClick={(event) => {
                          revokeReturnFocus.current = event.currentTarget;
                          setRevokeCandidate(installation);
                        }}
                        disabled={busy !== null}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="grid gap-5 desktop:grid-cols-2">
              <form
                className="border bg-card p-4 tablet:p-5"
                aria-label="Map a Slack user"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveIdentity(event.currentTarget);
                }}
              >
                <h2 className="font-display text-lg font-bold">
                  Map a Slack user
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Map one Slack user to one active Muster human. Approvals still
                  require the authoritative Muster capability checks.
                </p>
                {activeInstallations.length === 0 ? (
                  <p
                    className="mt-3 border bg-muted p-2 text-sm text-muted-foreground"
                    role="note"
                  >
                    Connect an active Slack workspace before mapping users.
                  </p>
                ) : settings.actors.length === 0 ? (
                  <p
                    className="mt-3 border bg-muted p-2 text-sm text-muted-foreground"
                    role="note"
                  >
                    No active Muster humans are available for identity mapping.
                  </p>
                ) : null}
                <label className="mt-4 grid gap-1 text-sm font-medium">
                  Workspace
                  <select
                    name="installationId"
                    required
                    disabled={activeInstallations.length === 0 || busy !== null}
                    className="h-9 border bg-background px-2 text-sm"
                  >
                    <option value="">Select workspace</option>
                    {activeInstallations.map((installation) => (
                      <option key={installation.id} value={installation.id}>
                        {installation.teamName ?? installation.teamId}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-3 grid gap-1 text-sm font-medium">
                  Slack user ID
                  <input
                    name="slackUserId"
                    required
                    maxLength={128}
                    placeholder="U0123456789"
                    className="h-9 border bg-background px-2 text-sm"
                    disabled={busy !== null}
                  />
                </label>
                <label className="mt-3 grid gap-1 text-sm font-medium">
                  Muster human
                  <select
                    name="actorId"
                    required
                    disabled={settings.actors.length === 0 || busy !== null}
                    className="h-9 border bg-background px-2 text-sm"
                  >
                    <option value="">Select human</option>
                    {settings.actors.map((actor) => (
                      <option key={actor.id} value={actor.id}>
                        {actor.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  className="mt-4"
                  type="submit"
                  disabled={
                    activeInstallations.length === 0 ||
                    settings.actors.length === 0 ||
                    busy !== null
                  }
                  state={busy === "identity" ? "loading" : "default"}
                >
                  Save identity mapping
                </Button>
                <div
                  className="mt-4 space-y-2"
                  aria-label="Existing Slack user mappings"
                >
                  {settings.identities.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No Slack identities are mapped yet.
                    </p>
                  ) : (
                    settings.identities.map((identity) => (
                      <p key={identity.id} className="border p-2 text-sm">
                        <span className="font-medium">
                          {identity.slackUserId}
                        </span>{" "}
                        → {identity.actorName} · {identity.status}
                      </p>
                    ))
                  )}
                </div>
              </form>

              <form
                className="border bg-card p-4 tablet:p-5"
                aria-label="Agent exposure policy"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveExposure(event.currentTarget);
                }}
              >
                <h2 className="font-display text-lg font-bold">
                  Agent exposure policy
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Channel mentions are allowed only for listed channel IDs.
                  Direct-message and thread-context access are explicit per
                  agent.
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Emergency execution control remains on each agent&apos;s{" "}
                  {settings.agents[0] ? (
                    <Link
                      className="font-medium text-foreground underline underline-offset-4"
                      href={`/agents/${settings.agents[0].id}/learning`}
                    >
                      kill switch
                    </Link>
                  ) : (
                    "kill switch"
                  )}
                  .
                </p>
                {activeInstallations.length === 0 ? (
                  <p
                    className="mt-3 border bg-muted p-2 text-sm text-muted-foreground"
                    role="note"
                  >
                    Connect an active Slack workspace before exposing agents.
                  </p>
                ) : settings.agents.length === 0 ? (
                  <p
                    className="mt-3 border bg-muted p-2 text-sm text-muted-foreground"
                    role="note"
                  >
                    No active agents are available. Restore or configure an
                    agent before creating a Slack policy.
                  </p>
                ) : null}
                <label className="mt-4 grid gap-1 text-sm font-medium">
                  Workspace
                  <select
                    name="installationId"
                    required
                    disabled={activeInstallations.length === 0 || busy !== null}
                    className="h-9 border bg-background px-2 text-sm"
                  >
                    <option value="">Select workspace</option>
                    {activeInstallations.map((installation) => (
                      <option key={installation.id} value={installation.id}>
                        {installation.teamName ?? installation.teamId}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-3 grid gap-1 text-sm font-medium">
                  Agent
                  <select
                    name="agentId"
                    required
                    disabled={settings.agents.length === 0 || busy !== null}
                    className="h-9 border bg-background px-2 text-sm"
                  >
                    <option value="">Select agent</option>
                    {settings.agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-3 grid gap-1 text-sm font-medium">
                  Approved channel IDs
                  <textarea
                    name="allowedChannelIds"
                    rows={3}
                    placeholder="C0123456789, C0987654321"
                    className="border bg-background p-2 text-sm"
                    disabled={busy !== null}
                  />
                </label>
                <fieldset className="mt-3 grid gap-2 text-sm">
                  <legend className="font-medium">Invocation policy</legend>
                  <label className="flex items-center gap-2">
                    <input
                      name="enabled"
                      type="checkbox"
                      checked={exposureEnabled}
                      onChange={(event) => {
                        setExposureEnabled(event.currentTarget.checked);
                        if (!event.currentTarget.checked)
                          setExposureDefault(false);
                      }}
                      disabled={busy !== null}
                    />{" "}
                    Enable this agent in Slack
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      name="isDefault"
                      type="checkbox"
                      checked={exposureDefault}
                      onChange={(event) =>
                        setExposureDefault(event.currentTarget.checked)
                      }
                      disabled={!exposureEnabled || busy !== null}
                    />{" "}
                    Default agent for this workspace
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      name="allowDirectMessages"
                      type="checkbox"
                      defaultChecked
                      disabled={busy !== null}
                    />{" "}
                    Allow direct messages
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      name="allowThreadContext"
                      type="checkbox"
                      disabled={busy !== null}
                    />{" "}
                    Allow bounded thread context
                  </label>
                </fieldset>
                <Button
                  className="mt-4"
                  type="submit"
                  disabled={
                    activeInstallations.length === 0 ||
                    settings.agents.length === 0 ||
                    busy !== null
                  }
                  state={busy === "exposure" ? "loading" : "default"}
                >
                  Save exposure policy
                </Button>
                <div
                  className="mt-4 space-y-2"
                  aria-label="Configured Slack agent exposures"
                >
                  {settings.exposures.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No agents are exposed to Slack yet.
                    </p>
                  ) : (
                    settings.exposures.map((exposure) => (
                      <p key={exposure.id} className="border p-2 text-sm">
                        <span className="font-medium">
                          {exposure.agentName}
                        </span>{" "}
                        · {exposure.enabled ? "enabled" : "disabled"}
                        {exposure.isDefault ? " · default" : ""} · DMs{" "}
                        {exposure.allowDirectMessages ? "allowed" : "blocked"} ·
                        thread context{" "}
                        {exposure.allowThreadContext ? "allowed" : "blocked"} ·
                        channels{" "}
                        {channels(exposure.allowedChannelIds).join(", ") ||
                          "none"}
                      </p>
                    ))
                  )}
                </div>
              </form>
            </section>

            <section
              className="border bg-card p-4 tablet:p-5"
              aria-labelledby="slack-deliveries-heading"
            >
              <h2
                id="slack-deliveries-heading"
                className="font-display text-lg font-bold"
              >
                Recent delivery diagnostics
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The last 20 deliveries are organisation-scoped and redacted.
                Inspect the related run in Muster for governed detail.
              </p>
              {settings.deliveries.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  No Slack deliveries have been recorded.
                </p>
              ) : (
                <div className="mt-4 space-y-2">
                  {settings.deliveries.map((delivery) => (
                    <article key={delivery.id} className="border p-3 text-sm">
                      <p>
                        <span className="font-medium">{delivery.status}</span> ·{" "}
                        {delivery.attemptCount} attempt
                        {delivery.attemptCount === 1 ? "" : "s"} ·{" "}
                        {date(delivery.updatedAt)}
                      </p>
                      <p className="mt-1 break-all text-muted-foreground">
                        Run {delivery.runId}
                      </p>
                      {delivery.lastError ? (
                        <p
                          role="alert"
                          className="mt-1 break-words text-[var(--color-error)]"
                        >
                          {delivery.lastError}
                        </p>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>

      {revokeCandidate ? (
        <div
          ref={revokeDialog}
          className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-overlay)] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="revoke-slack-title"
          aria-describedby="revoke-slack-description"
          onKeyDown={handleRevokeKeyDown}
        >
          <section className="w-full max-w-md border bg-background p-5 shadow-2xl">
            <h2
              id="revoke-slack-title"
              className="font-display text-lg font-bold"
            >
              Revoke Slack workspace?
            </h2>
            <p
              id="revoke-slack-description"
              className="mt-2 text-sm text-muted-foreground"
            >
              This disconnects{" "}
              {revokeCandidate.teamName ?? revokeCandidate.teamId}, disables its
              Slack access, and replaces the stored token. This cannot be
              undone; reconnect to install again.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                ref={revokeCancelButton}
                variant="outline"
                onClick={closeRevoke}
                disabled={busy !== null}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => void revoke()}
                disabled={busy !== null}
                state={busy === "revoke" ? "loading" : "default"}
              >
                Revoke workspace
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
