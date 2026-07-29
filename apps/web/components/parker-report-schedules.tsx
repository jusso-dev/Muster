"use client";
import { useCallback, useEffect, useState } from "react";
import { OpsShell } from "@/components/ops-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
type Schedule = {
  id: string;
  cadence: string;
  timezone: string;
  audience: string;
  nextRunAt: string;
  enabled: boolean;
};
export function ParkerReportSchedules() {
  const [data, setData] = useState<Schedule[]>([]);
  const [roomId, setRoomId] = useState("");
  const [cadence, setCadence] = useState("weekly");
  const [audience, setAudience] = useState("leadership");
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/v1/reports/schedules");
    const payload = (await response.json()) as {
      data?: Schedule[];
      error?: string;
    };
    if (!response.ok) setError(payload.error ?? "Could not load schedules");
    else {
      setData(payload.data ?? []);
      setError(null);
    }
  }, []);
  useEffect(() => void load(), [load]);
  const create = async () => {
    const response = await fetch("/api/v1/reports/schedules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomId,
        cadence,
        timezone,
        audience,
        idempotencyKey: `parker-ui:${roomId}:${cadence}:${audience}:${timezone}`,
      }),
    });
    if (!response.ok) {
      setError("Could not create schedule. Use a Parker room you belong to.");
      return;
    }
    setRoomId("");
    await load();
  };
  return (
    <OpsShell>
      <PageHeader
        eyebrow="Reports"
        title="Parker schedules"
        description="Weekly and monthly governed Parker report tasks."
      />
      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <label className="block text-sm">
          Room ID
          <input
            aria-label="Room ID"
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
            className="mt-1 h-10 w-full rounded border bg-background px-3"
            placeholder="Room UUID"
          />
        </label>
        <label className="block text-sm">
          Cadence
          <select
            aria-label="Cadence"
            value={cadence}
            onChange={(event) => setCadence(event.target.value)}
            className="mt-1 h-10 w-full rounded border bg-background px-3"
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <label className="block text-sm">
          Audience
          <select
            aria-label="Audience"
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
            className="mt-1 h-10 w-full rounded border bg-background px-3"
          >
            <option value="analyst">Analyst</option>
            <option value="leadership">Leadership</option>
            <option value="executive">Executive</option>
          </select>
        </label>
        <label className="block text-sm">
          Timezone
          <input
            aria-label="Timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="mt-1 h-10 w-full rounded border bg-background px-3"
          />
        </label>
        <Button disabled={!roomId || !timezone} onClick={() => void create()}>
          Create {cadence} schedule
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="space-y-2">
          {data.map((schedule) => (
            <article key={schedule.id} className="rounded border p-3">
              <strong>
                {schedule.cadence} {schedule.audience} report
              </strong>
              <p className="text-sm text-muted-foreground">
                {schedule.timezone} · next{" "}
                {new Date(schedule.nextRunAt).toLocaleString()}
              </p>
            </article>
          ))}
        </div>
      </section>
    </OpsShell>
  );
}
