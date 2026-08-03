type Briefing = {
  headlines?: string[];
  fleet?: { totals?: Record<string, number> } | null;
  cases?: {
    openCount?: number;
    agingCount?: number;
    unassignedCount?: number;
    mttrHint?: string;
  } | null;
  brolga?: { stats?: { entities?: number; claims?: number } } | null;
  errors?: string[];
  offline?: boolean;
};

async function loadBriefing(): Promise<Briefing> {
  const base = process.env.MUSTER_OPS_URL?.replace(/\/$/, "");
  if (!base) {
    return {
      offline: true,
      headlines: [
        "MUSTER_OPS_URL is not set — start apps/ops and point the web UI at it.",
        "Chat stays in Slack; this page is read-only status only.",
      ],
    };
  }
  try {
    const headers: HeadersInit = { accept: "application/json" };
    const token = process.env.MUSTER_OPS_TOKEN;
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${base}/api/v1/briefing`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return { offline: true, headlines: [`Ops API HTTP ${res.status}`] };
    }
    return (await res.json()) as Briefing;
  } catch (error) {
    return {
      offline: true,
      headlines: [error instanceof Error ? error.message : "Ops API unreachable"],
    };
  }
}

export default async function OpsPage() {
  const briefing = await loadBriefing();
  const fleet = briefing.fleet?.totals ?? {};
  const cases = briefing.cases;
  const stats = briefing.brolga?.stats;

  return (
    <main>
      <h1>Muster ops</h1>
      <p className="lead">
        Read-only posture from Tawny, Kelpie, and Brolga. Humans chat with one
        agent in <strong>Slack</strong>; tools are Mastra-backed in{" "}
        <code>apps/ops</code>.
      </p>

      <div className="banner">
        <strong>Not a chat product.</strong> Use Slack for conversation. This
        page only mirrors <code>GET /api/v1/briefing</code>.
      </div>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2>Headlines</h2>
        <ul className="headlines">
          {(briefing.headlines ?? ["No data"]).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {briefing.offline ? (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            Configure <code>MUSTER_OPS_URL</code> (and optional{" "}
            <code>MUSTER_OPS_TOKEN</code>) for the web process.
          </p>
        ) : null}
      </section>

      <div className="grid">
        <section className="card">
          <h2>Tawny fleet</h2>
          <div className="metric">{fleet.hosts ?? "—"}</div>
          <p className="muted">hosts</p>
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            online {fleet.online ?? "—"} · stale {fleet.stale ?? "—"} · offline{" "}
            {fleet.offline ?? "—"}
          </p>
        </section>

        <section className="card">
          <h2>Kelpie queue</h2>
          <div className="metric">{cases?.openCount ?? "—"}</div>
          <p className="muted">open cases</p>
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            aging {cases?.agingCount ?? "—"} · unassigned{" "}
            {cases?.unassignedCount ?? "—"}
          </p>
          {cases?.mttrHint ? (
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              {cases.mttrHint}
            </p>
          ) : null}
        </section>

        <section className="card">
          <h2>Brolga TI</h2>
          <div className="metric">{stats?.entities ?? "—"}</div>
          <p className="muted">entities</p>
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            claims {stats?.claims ?? "—"}
          </p>
        </section>
      </div>

      {(briefing.errors?.length ?? 0) > 0 ? (
        <section className="card" style={{ marginTop: "1rem" }}>
          <h2>Upstream errors</h2>
          <ul className="errors">
            {briefing.errors!.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
