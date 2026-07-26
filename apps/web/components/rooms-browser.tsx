"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Hash,
  LockKeyhole,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Star,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { browserUuid } from "@/lib/browser-uuid";
import { cn } from "@/lib/utils";

type RoomRecord = {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  topic: string;
  roomType: string;
  visibility: "organisation" | "private" | "restricted";
  archivedAt: string | null;
  membershipRole: string | null;
  favourite: boolean | null;
  muted: boolean | null;
  sidebarPosition: number | null;
  sidebarGroup: string | null;
  memberCount: number;
  owner: string | null;
  lastActivityAt: string | null;
};

type DirectoryActor = {
  id: string;
  displayName: string;
  actorType: string;
  status: string;
  jobTitle: string | null;
  team: string | null;
  presenceState: string | null;
  timezone: string | null;
};

type PendingInvitation = {
  id: string;
  roomId: string;
  roomName: string;
  membershipRole: string;
  accessExpiresAt: string | null;
  createdAt: string;
};

const roomTypes = [
  "operations",
  "incident",
  "investigation",
  "hunt",
  "engineering",
  "private",
  "system",
] as const;

function idempotencyKey(prefix: string) {
  return `${prefix}:${browserUuid()}`;
}

async function problemDetail(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    detail?: string;
  } | null;
  return payload?.detail ?? `Request failed (${response.status})`;
}

export function RoomsBrowser() {
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [directory, setDirectory] = useState<DirectoryActor[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState("all");
  const [membership, setMembership] = useState("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showDirect, setShowDirect] = useState(false);
  const [selectedActors, setSelectedActors] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setBusy("load");
    setError("");
    const parameters = new URLSearchParams({
      q: query,
      visibility,
      membership,
      includeArchived: String(includeArchived),
    });
    try {
      const response = await fetch(`/api/v1/rooms?${parameters}`);
      if (!response.ok) throw new Error(await problemDetail(response));
      const payload = (await response.json()) as { data: RoomRecord[] };
      setRooms(payload.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Rooms unavailable");
    } finally {
      setBusy(null);
    }
  }, [includeArchived, membership, query, visibility]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 180);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (!showDirect) return;
    void fetch("/api/v1/directory")
      .then(async (response) => {
        if (!response.ok) throw new Error(await problemDetail(response));
        const payload = (await response.json()) as { data: DirectoryActor[] };
        setDirectory(
          payload.data.filter(
            (actor) =>
              actor.status === "active" && actor.actorType !== "system",
          ),
        );
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : "Directory unavailable",
        ),
      );
  }, [showDirect]);

  useEffect(() => {
    void fetch("/api/v1/room-invitations")
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          data: PendingInvitation[];
        };
        setInvitations(payload.data);
      })
      .catch(() => undefined);
  }, []);

  async function roomAction(
    room: RoomRecord,
    action: "join" | "leave" | "archive" | "restore",
  ) {
    setBusy(room.id);
    setError("");
    const response = await fetch(`/api/v1/rooms/${room.id}/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        idempotencyKey: idempotencyKey(`room-${action}`),
      }),
    });
    if (!response.ok) {
      setError(await problemDetail(response));
      setBusy(null);
      return;
    }
    setNotice(`${room.displayName}: ${action} complete`);
    await refresh();
  }

  async function sidebarAction(
    room: RoomRecord,
    changes: Record<string, unknown>,
  ) {
    setBusy(room.id);
    setError("");
    const response = await fetch(`/api/v1/rooms/${room.id}/sidebar`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(changes),
    });
    if (!response.ok) {
      setError(await problemDetail(response));
      setBusy(null);
      return;
    }
    await refresh();
  }

  async function createRoom(formData: FormData) {
    setBusy("create");
    setError("");
    const displayName = String(formData.get("displayName") ?? "").trim();
    const roomType = String(formData.get("roomType") ?? "operations");
    const visibilityValue = String(
      formData.get("visibility") ?? "organisation",
    );
    const slug = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64);
    const response = await fetch("/api/v1/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: displayName,
        slug,
        displayName,
        description: String(formData.get("description") ?? ""),
        topic: String(formData.get("topic") ?? ""),
        roomType,
        visibility: visibilityValue,
        policies: {
          guestInvites: formData.get("guestInvites") === "on",
          agentInvites: formData.get("agentInvites") === "on",
          memberInvites: formData.get("memberInvites") === "on",
          broadMentions: formData.get("broadMentions") === "on",
          exportAllowed: formData.get("exportAllowed") === "on",
          retentionDays: null,
          archiveAfterDays: null,
        },
      }),
    });
    if (!response.ok) {
      setError(await problemDetail(response));
      setBusy(null);
      return;
    }
    setShowCreate(false);
    setNotice(`${displayName} created`);
    await refresh();
  }

  async function createDirect() {
    if (selectedActors.length === 0) {
      setError("Select at least one person or agent");
      return;
    }
    setBusy("direct");
    const response = await fetch("/api/v1/rooms/direct", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorIds: selectedActors,
        idempotencyKey: idempotencyKey("direct-room"),
      }),
    });
    if (!response.ok) {
      setError(await problemDetail(response));
      setBusy(null);
      return;
    }
    const payload = (await response.json()) as { data: RoomRecord };
    setShowDirect(false);
    setSelectedActors([]);
    window.location.assign(`/rooms/${payload.data.slug}`);
  }

  async function respondInvitation(
    invitation: PendingInvitation,
    action: "accept" | "decline",
  ) {
    setBusy(invitation.id);
    const response = await fetch(`/api/v1/room-invitations/${invitation.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        idempotencyKey: idempotencyKey(`invitation-${action}`),
      }),
    });
    if (!response.ok) {
      setError(await problemDetail(response));
      setBusy(null);
      return;
    }
    setInvitations((current) =>
      current.filter((candidate) => candidate.id !== invitation.id),
    );
    setNotice(
      action === "accept"
        ? `${invitation.roomName} invitation accepted`
        : `${invitation.roomName} invitation declined`,
    );
    await refresh();
  }

  const groupedRooms = useMemo(() => {
    const groups = new Map<string, RoomRecord[]>();
    for (const room of rooms) {
      const label =
        room.sidebarGroup ||
        (room.roomType === "direct" ? "Direct messages" : "Rooms");
      groups.set(label, [...(groups.get(label) ?? []), room]);
    }
    return [...groups.entries()];
  }, [rooms]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Workspace governance"
        title="Rooms"
        description="Discover, join and govern organisation rooms without exposing private work."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setShowDirect((open) => !open)}
            >
              <MessageSquare /> New message
            </Button>
            <Button
              variant="outline"
              onClick={() => window.location.assign("/rooms/admin")}
            >
              <Users /> Administration
            </Button>
            <Button onClick={() => setShowCreate((open) => !open)}>
              <Plus /> Create room
            </Button>
          </>
        }
      />
      <div className="scroll-region min-h-0 flex-1 overflow-y-auto p-3 tablet:p-5">
        <div className="mx-auto max-w-6xl space-y-4">
          <section
            aria-label="Room filters"
            className="grid gap-3 rounded-lg border bg-[var(--color-paper-2)] p-3 tablet:grid-cols-[minmax(12rem,1fr)_repeat(3,auto)]"
          >
            <label className="relative">
              <span className="sr-only">Search rooms</span>
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, purpose or topic"
                className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-xs outline-none focus:border-[var(--color-focus)]"
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <span>Visibility</span>
              <select
                value={visibility}
                onChange={(event) => setVisibility(event.target.value)}
                className="h-9 rounded-md border bg-background px-2"
              >
                <option value="all">All</option>
                <option value="organisation">Organisation</option>
                <option value="private">Private</option>
                <option value="restricted">Restricted</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs">
              <span>Membership</span>
              <select
                value={membership}
                onChange={(event) => setMembership(event.target.value)}
                className="h-9 rounded-md border bg-background px-2"
              >
                <option value="all">All visible</option>
                <option value="joined">Joined</option>
                <option value="available">Available</option>
              </select>
            </label>
            <label className="flex min-h-9 items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => setIncludeArchived(event.target.checked)}
                className="size-5"
              />
              Archived
            </label>
          </section>

          {invitations.length > 0 && (
            <section className="rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-4">
              <h2 className="font-display text-sm font-bold">
                Room invitations
              </h2>
              <div className="mt-3 space-y-2">
                {invitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex flex-wrap items-center gap-2 rounded border bg-background p-3 text-xs"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">
                        {invitation.roomName}
                      </span>
                      <span className="text-muted-foreground">
                        {invitation.membershipRole}
                        {invitation.accessExpiresAt
                          ? ` · expires ${new Date(
                              invitation.accessExpiresAt,
                            ).toLocaleString()}`
                          : ""}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      onClick={() =>
                        void respondInvitation(invitation, "accept")
                      }
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void respondInvitation(invitation, "decline")
                      }
                    >
                      Decline
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {showCreate && (
            <form
              className="rounded-lg border bg-[var(--color-paper-2)] p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void createRoom(new FormData(event.currentTarget));
              }}
            >
              <h2 className="font-display text-sm font-bold">Create room</h2>
              <div className="mt-3 grid gap-3 tablet:grid-cols-2">
                <label className="text-xs font-semibold">
                  Name
                  <input
                    name="displayName"
                    required
                    minLength={2}
                    maxLength={80}
                    className="mt-1 h-9 w-full rounded-md border bg-background px-3 font-normal"
                  />
                </label>
                <label className="text-xs font-semibold">
                  Type
                  <select
                    name="roomType"
                    className="mt-1 h-9 w-full rounded-md border bg-background px-3 font-normal"
                  >
                    {roomTypes.map((roomType) => (
                      <option key={roomType} value={roomType}>
                        {roomType}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold">
                  Visibility
                  <select
                    name="visibility"
                    className="mt-1 h-9 w-full rounded-md border bg-background px-3 font-normal"
                  >
                    <option value="organisation">Organisation</option>
                    <option value="private">Private</option>
                    <option value="restricted">Restricted</option>
                  </select>
                </label>
                <label className="text-xs font-semibold">
                  Topic
                  <input
                    name="topic"
                    maxLength={500}
                    className="mt-1 h-9 w-full rounded-md border bg-background px-3 font-normal"
                  />
                </label>
                <label className="text-xs font-semibold tablet:col-span-2">
                  Purpose
                  <textarea
                    name="description"
                    maxLength={2_000}
                    rows={3}
                    className="mt-1 w-full rounded-md border bg-background p-3 font-normal"
                  />
                </label>
              </div>
              <fieldset className="mt-3 flex flex-wrap gap-4 text-xs">
                <legend className="mb-2 font-semibold">Room policy</legend>
                {[
                  ["guestInvites", "Guest invites"],
                  ["agentInvites", "Agent invites"],
                  ["memberInvites", "Member invites"],
                  ["broadMentions", "Broad mentions"],
                  ["exportAllowed", "Export"],
                ].map(([name, label]) => (
                  <label key={name} className="flex min-h-9 items-center gap-2">
                    <input name={name} type="checkbox" className="size-5" />
                    {label}
                  </label>
                ))}
              </fieldset>
              <div className="mt-4 flex gap-2">
                <Button type="submit" disabled={busy === "create"}>
                  {busy === "create" ? "Creating…" : "Create"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {showDirect && (
            <section className="rounded-lg border bg-[var(--color-paper-2)] p-4">
              <h2 className="font-display text-sm font-bold">
                New direct or group message
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                The same participant set always reopens the same private
                conversation.
              </p>
              <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto tablet:grid-cols-2">
                {directory.map((actor) => (
                  <label
                    key={actor.id}
                    className="flex min-h-11 items-center gap-3 rounded border bg-background px-3 text-xs"
                  >
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={selectedActors.includes(actor.id)}
                      onChange={(event) =>
                        setSelectedActors((current) =>
                          event.target.checked
                            ? [...current, actor.id]
                            : current.filter((id) => id !== actor.id),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {actor.displayName}
                      </span>
                      <span className="block truncate text-muted-foreground">
                        {actor.actorType === "agent"
                          ? "Agent"
                          : actor.jobTitle ||
                            actor.team ||
                            actor.timezone ||
                            "Member"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  onClick={() => void createDirect()}
                  disabled={busy === "direct"}
                >
                  <MessageSquare />
                  {busy === "direct" ? "Opening…" : "Open conversation"}
                </Button>
                <Button variant="ghost" onClick={() => setShowDirect(false)}>
                  Cancel
                </Button>
              </div>
            </section>
          )}

          {error && (
            <p
              role="alert"
              className="rounded border border-[var(--color-error)] p-3 text-xs text-[var(--color-error)]"
            >
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="rounded border success-surface p-3 text-xs text-[var(--color-success)]"
            >
              {notice}
            </p>
          )}

          {busy === "load" && rooms.length === 0 ? (
            <div className="grid min-h-40 place-items-center text-xs text-muted-foreground">
              <RefreshCw className="mb-2 size-5 animate-spin" />
              Loading governed rooms
            </div>
          ) : groupedRooms.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <Hash className="mx-auto size-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-semibold">No visible rooms</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Private rooms only appear after an invitation is accepted.
              </p>
            </div>
          ) : (
            groupedRooms.map(([group, groupRooms]) => (
              <section key={group}>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {group}
                </h2>
                <div className="grid gap-3 wide:grid-cols-2">
                  {groupRooms.map((room) => (
                    <article
                      key={room.id}
                      className={cn(
                        "rounded-lg border bg-[var(--color-paper-2)] p-4",
                        room.archivedAt && "opacity-70",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted">
                          {room.roomType === "direct" ? (
                            <MessageSquare className="size-4" />
                          ) : room.visibility === "organisation" ? (
                            <Hash className="size-4" />
                          ) : (
                            <LockKeyhole className="size-4" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/rooms/${room.slug}`}
                              className="truncate font-display text-sm font-bold hover:underline"
                            >
                              {room.displayName}
                            </Link>
                            <Badge>{room.roomType}</Badge>
                            {room.archivedAt && <Badge>Archived</Badge>}
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {room.description ||
                              room.topic ||
                              "No purpose recorded"}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Users className="size-3" /> {room.memberCount}
                            </span>
                            <span>Owner: {room.owner || "Unassigned"}</span>
                            <span>{room.visibility}</span>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
                        {room.membershipRole ? (
                          <>
                            <Button
                              size="sm"
                              variant={room.favourite ? "secondary" : "ghost"}
                              aria-label={
                                room.favourite
                                  ? `Remove ${room.displayName} from starred`
                                  : `Star ${room.displayName}`
                              }
                              onClick={() =>
                                void sidebarAction(room, {
                                  favourite: !room.favourite,
                                })
                              }
                            >
                              <Star
                                className={cn(room.favourite && "fill-current")}
                              />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={
                                room.muted
                                  ? `Unmute ${room.displayName}`
                                  : `Mute ${room.displayName}`
                              }
                              onClick={() =>
                                void sidebarAction(room, { muted: !room.muted })
                              }
                            >
                              {room.muted ? <VolumeX /> : <Volume2 />}
                            </Button>
                            {room.membershipRole !== "owner" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void roomAction(room, "leave")}
                              >
                                Leave
                              </Button>
                            )}
                            {(room.membershipRole === "owner" ||
                              room.membershipRole === "moderator") && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void roomAction(
                                    room,
                                    room.archivedAt ? "restore" : "archive",
                                  )
                                }
                              >
                                <Archive />
                                {room.archivedAt ? "Restore" : "Archive"}
                              </Button>
                            )}
                          </>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => void roomAction(room, "join")}
                            disabled={room.visibility !== "organisation"}
                          >
                            Join
                          </Button>
                        )}
                      </div>
                      {room.membershipRole && (
                        <details className="mt-2 text-xs">
                          <summary className="min-h-8 cursor-pointer py-2 text-muted-foreground">
                            Sidebar group and order
                          </summary>
                          <form
                            className="grid grid-cols-[1fr_6rem_auto] gap-2"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const form = new FormData(event.currentTarget);
                              void sidebarAction(room, {
                                sidebarGroup:
                                  String(
                                    form.get("sidebarGroup") ?? "",
                                  ).trim() || null,
                                sidebarPosition: Number(
                                  form.get("sidebarPosition") ?? 0,
                                ),
                              });
                            }}
                          >
                            <label>
                              <span className="sr-only">Sidebar group</span>
                              <input
                                name="sidebarGroup"
                                defaultValue={room.sidebarGroup ?? ""}
                                maxLength={80}
                                placeholder="Group"
                                className="h-9 w-full rounded border bg-background px-2"
                              />
                            </label>
                            <label>
                              <span className="sr-only">Sidebar order</span>
                              <input
                                name="sidebarPosition"
                                type="number"
                                min={0}
                                max={10_000}
                                defaultValue={room.sidebarPosition ?? 0}
                                className="h-9 w-full rounded border bg-background px-2"
                              />
                            </label>
                            <Button type="submit" size="sm" variant="outline">
                              Save
                            </Button>
                          </form>
                        </details>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
