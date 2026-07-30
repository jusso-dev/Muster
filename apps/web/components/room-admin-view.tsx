"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type AdminData = {
  rooms: Array<{
    id: string;
    displayName: string;
    visibility: string;
    roomType: string;
    owner: string | null;
    memberCount: number;
  }>;
  actors: Array<{
    id: string;
    displayName: string;
    actorType: string;
    status: string;
    jobTitle: string | null;
    timezone: string | null;
  }>;
  invitations: Array<{
    id: string;
    roomName: string;
    actorName: string;
    role: string;
    status: string;
    accessExpiresAt: string | null;
  }>;
  owners: Array<{
    roomId: string;
    actorName: string;
    role: string;
  }>;
  guests: Array<{
    roomId: string;
    actorName: string;
    accessExpiresAt: string | null;
  }>;
  agents: Array<{
    roomId: string;
    actorName: string;
    accessExpiresAt: string | null;
  }>;
  audit: Array<{
    id: string;
    action: string;
    targetId: string;
    actorId: string;
    createdAt: string;
  }>;
};

const tabs = [
  "Invitations",
  "Users",
  "Guests",
  "Agents",
  "Ownership",
  "Audit",
] as const;

export function RoomAdminView() {
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]>("Invitations");
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/v1/rooms/admin")
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            detail?: string;
          } | null;
          throw new Error(payload?.detail ?? "Administration unavailable");
        }
        const payload = (await response.json()) as { data: AdminData };
        setData(payload.data);
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : "Administration unavailable",
        ),
      );
  }, []);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Configure"
        title="Room governance"
        description="Organisation-wide invitations, users, guests, agents, ownership and room audit."
        actions={
          <Link
            href="/rooms"
            className="inline-flex min-h-9 items-center rounded-md border px-3 text-xs font-semibold hover:bg-muted"
          >
            Back to rooms
          </Link>
        }
      />
      <div className="scroll-region min-h-0 flex-1 overflow-y-auto p-3 tablet:p-5">
        <div className="mx-auto max-w-6xl">
          {error && (
            <div role="alert" className="rounded-lg border p-6 text-sm">
              <p className="font-bold">Room administration is restricted.</p>
              <p className="mt-2 text-xs text-muted-foreground">{error}</p>
            </div>
          )}
          {data && (
            <>
              <div
                role="tablist"
                aria-label="Room administration sections"
                className="flex gap-1 overflow-x-auto border-b"
              >
                {tabs.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    role="tab"
                    aria-selected={tab === candidate}
                    onClick={() => setTab(candidate)}
                    className={cn(
                      "min-h-10 shrink-0 border-b-2 border-transparent px-3 text-xs text-muted-foreground",
                      tab === candidate &&
                        "border-[var(--color-accent)] font-semibold text-foreground",
                    )}
                  >
                    {candidate}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid gap-3">
                {tab === "Invitations" &&
                  data.invitations.map((item) => (
                    <AdminRow
                      key={item.id}
                      title={`${item.actorName} → ${item.roomName}`}
                      meta={`${item.role} · ${
                        item.accessExpiresAt
                          ? `expires ${new Date(
                              item.accessExpiresAt,
                            ).toLocaleString()}`
                          : "no expiry"
                      }`}
                      badge={item.status}
                    />
                  ))}
                {tab === "Users" &&
                  data.actors.map((item) => (
                    <AdminRow
                      key={item.id}
                      title={item.displayName}
                      meta={`${item.actorType} · ${item.jobTitle || "No title"} · ${
                        item.timezone || "No timezone"
                      }`}
                      badge={item.status}
                    />
                  ))}
                {tab === "Guests" &&
                  data.guests.map((item) => (
                    <AdminRow
                      key={`${item.roomId}:${item.actorName}`}
                      title={item.actorName}
                      meta={`Room ${item.roomId} · ${
                        item.accessExpiresAt
                          ? `expires ${new Date(
                              item.accessExpiresAt,
                            ).toLocaleString()}`
                          : "expiry missing"
                      }`}
                      badge="guest"
                    />
                  ))}
                {tab === "Agents" &&
                  data.agents.map((item) => (
                    <AdminRow
                      key={`${item.roomId}:${item.actorName}`}
                      title={item.actorName}
                      meta={`Room ${item.roomId}`}
                      badge="agent"
                    />
                  ))}
                {tab === "Ownership" &&
                  data.rooms.map((room) => (
                    <AdminRow
                      key={room.id}
                      title={room.displayName}
                      meta={`${room.visibility} · ${room.roomType} · ${room.memberCount} members`}
                      badge={room.owner || "No owner"}
                    />
                  ))}
                {tab === "Audit" &&
                  data.audit.map((item) => (
                    <AdminRow
                      key={item.id}
                      title={item.action}
                      meta={`${new Date(item.createdAt).toLocaleString()} · room ${item.targetId}`}
                      badge="audited"
                    />
                  ))}
                {((tab === "Invitations" && data.invitations.length === 0) ||
                  (tab === "Guests" && data.guests.length === 0) ||
                  (tab === "Agents" && data.agents.length === 0) ||
                  (tab === "Audit" && data.audit.length === 0)) && (
                  <p className="rounded border border-dashed p-8 text-center text-xs text-muted-foreground">
                    No records in this section.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function AdminRow({
  title,
  meta,
  badge,
}: {
  title: string;
  meta: string;
  badge: string;
}) {
  return (
    <article className="flex flex-wrap items-center gap-3 rounded-lg border bg-[var(--color-paper-2)] p-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="mt-1 break-all text-xs text-muted-foreground">{meta}</p>
      </div>
      <Badge>{badge}</Badge>
    </article>
  );
}
