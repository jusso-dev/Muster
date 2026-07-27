"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
type Schedule = { id: string; cadence: string; timezone: string; audience: string; nextRunAt: string; enabled: boolean };
export function ParkerReportSchedules() {
  const [data, setData] = useState<Schedule[]>([]); const [roomId, setRoomId] = useState(""); const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { const response = await fetch("/api/v1/reports/schedules"); const payload = await response.json() as { data?: Schedule[]; error?: string }; if (!response.ok) setError(payload.error ?? "Could not load schedules"); else { setData(payload.data ?? []); setError(null); } }, []);
  useEffect(() => void load(), [load]);
  const create = async () => { const response = await fetch("/api/v1/reports/schedules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomId, cadence: "weekly", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", audience: "leadership", idempotencyKey: `parker-ui:${roomId}:weekly` }) }); if (!response.ok) { setError("Could not create schedule. Use a room you belong to."); return; } setRoomId(""); await load(); };
  return <AppShell><PageHeader eyebrow="Reports" title="Parker schedules" description="Weekly and monthly governed Parker report tasks." /><section className="space-y-4 rounded-xl border border-border bg-card p-5"><label className="block text-sm">Room ID<input aria-label="Room ID" value={roomId} onChange={(event) => setRoomId(event.target.value)} className="mt-1 h-10 w-full rounded border bg-background px-3" placeholder="Room UUID" /></label><Button disabled={!roomId} onClick={() => void create()}>Create weekly schedule</Button>{error ? <p className="text-sm text-destructive">{error}</p> : null}<div className="space-y-2">{data.map((schedule) => <article key={schedule.id} className="rounded border p-3"><strong>{schedule.cadence} {schedule.audience} report</strong><p className="text-sm text-muted-foreground">{schedule.timezone} · next {new Date(schedule.nextRunAt).toLocaleString()}</p></article>)}</div></section></AppShell>;
}
