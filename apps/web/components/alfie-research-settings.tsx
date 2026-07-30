"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { OpsShell } from "@/components/ops-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Room = { id: string; displayName: string; slug: string };
type Watchlist = {
  id: string;
  name: string;
  vendors: unknown;
  technologies: unknown;
  cadenceMinutes: number;
  enabled: boolean;
  nextRunAt: string;
};

function values(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function AlfieResearchSettings() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [roomResponse, watchlistResponse] = await Promise.all([
        fetch("/api/v1/rooms?membership=joined"),
        fetch("/api/v1/research-watchlists"),
      ]);
      const roomsPayload = (await roomResponse.json()) as {
        data?: Room[];
        detail?: string;
      };
      const watchlistsPayload = (await watchlistResponse.json()) as {
        data?: Watchlist[];
        detail?: string;
      };
      if (!roomResponse.ok)
        throw new Error(roomsPayload.detail ?? "Rooms unavailable.");
      if (!watchlistResponse.ok)
        throw new Error(
          watchlistsPayload.detail ?? "Research watchlists unavailable.",
        );
      setRooms(roomsPayload.data ?? []);
      setWatchlists(watchlistsPayload.data ?? []);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Research settings unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const split = (key: string) =>
      (form.get(key)?.toString() ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/v1/research-watchlists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          roomId: form.get("roomId"),
          vendors: split("vendors"),
          technologies: split("technologies"),
          cadenceMinutes: Number(form.get("cadenceMinutes")),
          sources: [{ name: "CISA KEV", url: form.get("sourceUrl") }],
        }),
      });
      const payload = (await response.json()) as { detail?: string };
      if (!response.ok)
        throw new Error(payload.detail ?? "Watchlist creation failed.");
      formElement.reset();
      setNotice(
        "Watchlist saved. Alfie will run only allowlisted bounded feeds.",
      );
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Watchlist creation failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <OpsShell>
      <PageHeader
        eyebrow="Configure"
        title="Alfie research watchlists"
        description="Bounded, allowlisted public and vendor research. Feed content remains untrusted evidence."
        actions={
          <Link
            href="/settings"
            className="inline-flex min-h-9 items-center rounded-md border px-3 text-xs font-semibold hover:bg-muted"
          >
            Back to settings
          </Link>
        }
      />
      <div className="scroll-region overflow-y-auto p-4 tablet:p-6">
        <div className="mx-auto grid max-w-6xl gap-5 desktop:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold">
                  Approved research
                </h2>
                <p className="text-xs text-muted-foreground">
                  Cadence is 15 minutes to 7 days. CISA KEV is default trusted
                  source.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => void refresh()}
              >
                <RefreshCw /> Refresh
              </Button>
            </div>
            {loading ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Loading watchlists…
              </p>
            ) : watchlists.length === 0 ? (
              <p className="mt-4 rounded border border-dashed p-5 text-sm text-muted-foreground">
                No Alfie watchlists configured.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {watchlists.map((watchlist) => (
                  <article key={watchlist.id} className="rounded border p-3">
                    <div className="flex justify-between gap-2">
                      <div>
                        <h3 className="font-semibold">{watchlist.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          {values(watchlist.vendors).join(", ") ||
                            "All vendors"}{" "}
                          ·{" "}
                          {values(watchlist.technologies).join(", ") ||
                            "All technologies"}
                        </p>
                      </div>
                      <Badge>{watchlist.enabled ? "enabled" : "paused"}</Badge>
                    </div>
                    <p className="mt-2 text-xs">
                      Every {watchlist.cadenceMinutes} min · next{" "}
                      {new Date(watchlist.nextRunAt).toLocaleString()}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>
          <form
            onSubmit={(event) => void create(event)}
            className="h-fit rounded-lg border bg-card p-4 space-y-3"
          >
            <div className="flex gap-2">
              <ShieldCheck className="mt-0.5 size-4 text-muted-foreground" />
              <div>
                <h2 className="font-semibold">New watchlist</h2>
                <p className="text-xs text-muted-foreground">
                  Only configured approved HTTPS origins work in production.
                </p>
              </div>
            </div>
            <label className="block text-xs font-semibold">
              Name
              <input
                required
                name="name"
                className="mt-1 h-10 w-full rounded border bg-background px-3 text-sm"
                placeholder="Microsoft security"
              />
            </label>
            <label className="block text-xs font-semibold">
              Room
              <select
                required
                name="roomId"
                className="mt-1 h-10 w-full rounded border bg-background px-3 text-sm"
              >
                <option value="">Select room</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.displayName || room.slug}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold">
              Vendors
              <input
                name="vendors"
                className="mt-1 h-10 w-full rounded border bg-background px-3 text-sm"
                placeholder="Microsoft, Cisco"
              />
            </label>
            <label className="block text-xs font-semibold">
              Technologies
              <input
                name="technologies"
                className="mt-1 h-10 w-full rounded border bg-background px-3 text-sm"
                placeholder="Sentinel, Defender, Entra"
              />
            </label>
            <label className="block text-xs font-semibold">
              Cadence minutes
              <input
                required
                name="cadenceMinutes"
                type="number"
                min="15"
                max="10080"
                defaultValue="240"
                className="mt-1 h-10 w-full rounded border bg-background px-3 text-sm"
              />
            </label>
            <label className="block text-xs font-semibold">
              Source URL
              <input
                required
                name="sourceUrl"
                type="url"
                defaultValue="https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
                className="mt-1 h-10 w-full rounded border bg-background px-3 text-sm"
              />
            </label>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            {notice && (
              <p className="text-xs text-[var(--color-success)]">{notice}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={busy || rooms.length === 0}
            >
              {busy ? "Saving…" : "Save watchlist"}
            </Button>
          </form>
        </div>
      </div>
    </OpsShell>
  );
}
