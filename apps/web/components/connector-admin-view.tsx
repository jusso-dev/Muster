"use client";

import { useEffect, useState } from "react";
import { OpsShell } from "@/components/ops-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { browserUuid } from "@/lib/browser-uuid";

type Connector = {
  id: string;
  displayName: string;
  product: string;
  status: string;
  configuration: { baseUrl?: string; authType?: string; testMode?: boolean };
};

const syntheticTemplate = {
  key: "generic.alerts.list",
  version: 1,
  displayName: "List alerts",
  method: "GET",
  pathTemplate: "/alerts",
  requiredCapability: "alerts.read",
  inputSchema: { type: "object", additionalProperties: false },
  outputSchema: {
    type: "object",
    required: ["records"],
    properties: { records: { type: "array" } },
  },
  recordsPath: "records",
};

export function ConnectorAdminView() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/v1/connectors");
    if (response.ok) {
      const body = (await response.json()) as { data: Connector[] };
      setConnectors(body.data);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function configure(form: FormData) {
    setBusy(true);
    setMessage("");
    const baseUrl = String(form.get("baseUrl") ?? "");
    const token = String(form.get("token") ?? "");
    const product = String(form.get("product") ?? "");
    const response = await fetch("/api/v1/connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        product,
        instanceId: form.get("instanceId"),
        displayName: form.get("displayName"),
        baseUrl,
        allowedHosts: [new URL(baseUrl).hostname],
        allowPrivateNetwork: form.get("allowPrivateNetwork") === "on",
        testMode: form.get("testMode") === "on",
        auth: token
          ? product === "unifi"
            ? { type: "api_key", headerName: "X-API-Key", token }
            : { type: "bearer", token }
          : { type: "none" },
        limits: {
          timeoutMs: 10_000,
          maxResponseBytes: 1_000_000,
          maxRecords: 1_000,
          maxPages: 10,
          requestsPerMinute: 60,
        },
        templates:
          form.get("product") === "generic_rest" ? [syntheticTemplate] : [],
      }),
    });
    const body = (await response.json()) as {
      data?: { id: string };
      detail?: string;
    };
    setMessage(
      response.ok
        ? `Connector ${body.data?.id ?? ""} configured. Secret stored server-side.`
        : (body.detail ?? "Configuration failed."),
    );
    await refresh();
    setBusy(false);
  }

  async function testConnector(connector: Connector) {
    setBusy(true);
    setMessage("Query queued…");
    const response = await fetch(`/api/v1/connectors/${connector.id}/queries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        templateKey:
          {
            defender_endpoint: "mde.alerts.list",
            tawny: "tawny.inventory.list",
            tawny_response: "tawny.inventory.list",
            kelpie: "kelpie.cases.list",
            unifi: "unifi.sites.list",
          }[connector.product] ?? "generic.alerts.list",
        input: connector.product === "unifi" ? { offset: 0, limit: 25 } : {},
        idempotencyKey: `connector-test-${browserUuid()}`,
      }),
    });
    const queued = (await response.json()) as {
      data?: { id: string };
      detail?: string;
    };
    if (!response.ok || !queued.data?.id) {
      setMessage(queued.detail ?? "Test query failed to queue.");
      setBusy(false);
      return;
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const result = await fetch(`/api/v1/connector-queries/${queued.data.id}`);
      const body = (await result.json()) as {
        data?: {
          status: string;
          errorCode?: string;
          responseMetadata?: unknown;
        };
      };
      if (body.data?.status === "succeeded") {
        setMessage(
          `Bounded test passed: ${JSON.stringify(body.data.responseMetadata)}`,
        );
        setBusy(false);
        return;
      }
      if (body.data?.status === "failed") {
        setMessage(`Test failed safely: ${body.data.errorCode ?? "unknown"}`);
        setBusy(false);
        return;
      }
    }
    setMessage("Test remains queued; inspect delivery history.");
    setBusy(false);
  }

  return (
    <OpsShell>
      <PageHeader
        eyebrow="Administration"
        title="Governed connectors"
        description="Secrets stay server-side. Queries use versioned templates, fixed egress and hard limits."
      />
      <div className="scroll-region overflow-y-auto p-4 tablet:p-6">
        <div className="mx-auto grid max-w-5xl gap-5 wide:grid-cols-2">
          <form action={configure} className="space-y-4 border bg-card p-4">
            <h2 className="font-display text-lg font-bold">Configure</h2>
            <label className="block text-xs font-semibold">
              Product
              <select
                name="product"
                className="mt-1 h-10 w-full border bg-card px-3"
              >
                <option value="generic_rest">Generic REST</option>
                <option value="defender_endpoint">Defender for Endpoint</option>
                <option value="defender_cloud">Defender for Cloud</option>
                <option value="sentinel">Sentinel / Log Analytics</option>
                <option value="firewall">Firewall REST</option>
                <option value="cspm">CSPM REST</option>
                <option value="tawny">Tawny read-only</option>
                <option value="tawny_response">Tawny approved response</option>
                <option value="kelpie">Kelpie case management</option>
                <option value="unifi">UniFi Network read-only</option>
              </select>
            </label>
            {[
              ["displayName", "Display name", "Synthetic security source"],
              ["instanceId", "Instance ID", "synthetic-source"],
              ["baseUrl", "Base URL", "http://mock-connector:4020"],
              ["token", "Bearer token (optional)", ""],
            ].map(([name, label, placeholder]) => (
              <label key={name} className="block text-xs font-semibold">
                {label}
                <input
                  name={name}
                  type={name === "token" ? "password" : "text"}
                  required={name !== "token"}
                  autoComplete={name === "token" ? "new-password" : "off"}
                  placeholder={placeholder}
                  className="mt-1 h-10 w-full border bg-card px-3"
                />
              </label>
            ))}
            <label className="flex gap-2 text-xs">
              <input name="testMode" type="checkbox" /> Test mode (permits HTTP)
            </label>
            <label className="flex gap-2 text-xs">
              <input name="allowPrivateNetwork" type="checkbox" /> Allow
              approved private host
            </label>
            <Button type="submit" disabled={busy}>
              Save encrypted connector
            </Button>
          </form>
          <section className="border bg-card p-4">
            <h2 className="font-display text-lg font-bold">
              Configured sources
            </h2>
            <div className="mt-3 space-y-2">
              {connectors.map((connector) => (
                <div
                  key={connector.id}
                  className="flex items-center gap-3 border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {connector.displayName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {connector.product} · {connector.configuration.baseUrl}
                    </p>
                  </div>
                  <Badge>{connector.status}</Badge>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void testConnector(connector)}
                  >
                    Test
                  </Button>
                </div>
              ))}
              {connectors.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No connector configured.
                </p>
              )}
            </div>
            {message && (
              <p role="status" className="mt-4 border p-3 text-sm">
                {message}
              </p>
            )}
          </section>
        </div>
      </div>
    </OpsShell>
  );
}
