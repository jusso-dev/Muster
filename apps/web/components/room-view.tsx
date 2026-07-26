"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  CircleCheck,
  Clock3,
  Hash,
  MessageSquare,
  Pin,
  Search,
  SmilePlus,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { browserUuid } from "@/lib/browser-uuid";
import { AppShell } from "@/components/app-shell";
import {
  RoomComposer,
  type RoomMessageRecord,
} from "@/components/room-composer";
import { SeverityBadge } from "@/components/severity";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  activeInvestigation,
  demoAgents,
  demoDirectRooms,
  demoMode,
  demoPeople,
  demoRooms,
  roomIdBySlug,
  roomTimeline,
} from "@/lib/demo-data";
import { cn } from "@/lib/utils";

type TimelineItem = (typeof roomTimeline)[number];

const persistedTimelineIds = new Set([
  "018f55d8-c4c7-7c3e-88ef-000000000701",
  "018f55d8-c4c7-7c3e-88ef-000000000705",
]);
const seededThreadMessageIds = new Set([
  "018f55d8-c4c7-7c3e-88ef-000000000702",
  "018f55d8-c4c7-7c3e-88ef-000000000703",
  "018f55d8-c4c7-7c3e-88ef-000000000704",
]);
const actorIdentity: Record<
  string,
  { name: string; initials: string; agent: boolean }
> = Object.fromEntries([
  ...demoPeople.map((actor) => [
    actor.id,
    { name: actor.name, initials: actor.initials, agent: false },
  ]),
  ...demoAgents.map((actor) => [
    actor.id,
    { name: actor.name, initials: actor.initials, agent: true },
  ]),
]);

function MessageActions({
  canPersist,
  onThread,
  onReact,
}: {
  canPersist: boolean;
  onThread: () => void;
  onReact: () => void;
}) {
  return (
    <div className="message-actions absolute right-3 top-1 hidden items-center rounded border bg-popover p-0.5 shadow-sm group-hover:flex group-focus-within:flex">
      <Button
        variant="ghost"
        size="icon"
        className="size-7 min-h-7"
        aria-label="React"
        disabled={!canPersist}
        onClick={onReact}
      >
        <SmilePlus />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 min-h-7"
        aria-label="Start thread"
        disabled={!canPersist}
        onClick={onThread}
      >
        <MessageSquare />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 min-h-7"
        aria-label="Pin (coming soon)"
        disabled
      >
        <Pin />
      </Button>
    </div>
  );
}

function TimelineEntry({
  item,
  onThread,
  onReact,
  reactionCounts,
}: {
  item: TimelineItem;
  onThread: (item: TimelineItem) => void;
  onReact: (item: TimelineItem, emoji: "eyes" | "check" | "thumbsup") => void;
  reactionCounts: Record<string, number>;
}) {
  const canPersist = persistedTimelineIds.has(item.id);
  const defaultEmoji =
    item.type === "human" && item.reactions?.[0]?.emoji === "check"
      ? "check"
      : "eyes";
  if (item.type === "system") {
    return (
      <div className="flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <CircleCheck className="size-3.5" />
        <span>
          <strong className="text-foreground">{item.title}</strong> ·{" "}
          {item.body} · {item.time}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

  if (item.type === "human") {
    return (
      <article className="group relative flex gap-3 px-4 py-3 hover:bg-muted/50">
        <Avatar initials={item.initials} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-bold">{item.author}</h3>
            <span className="text-xs text-muted-foreground">
              {item.role} · {item.time}
            </span>
          </div>
          <p className="message-prose mt-1 text-sm leading-5 text-[var(--color-ink-2)]">
            {item.body}
          </p>
          <div className="mt-2 flex items-center gap-2">
            {item.reactions?.map((reaction) => (
              <button
                key={reaction.label}
                onClick={() => onReact(item, reaction.emoji)}
                className="rounded border bg-muted px-2 py-0.5 text-xs"
                aria-label={`${reaction.label}, ${reactionCounts[`${item.id}:${reaction.emoji}`] ?? reaction.count}`}
              >
                {reaction.emoji === "eyes" ? "Reviewing" : "Agreed"} ·{" "}
                {reactionCounts[`${item.id}:${reaction.emoji}`] ??
                  reaction.count}
              </button>
            ))}
            {item.replies > 0 && (
              <button
                onClick={() => onThread(item)}
                className="text-xs font-semibold text-[var(--color-accent)]"
              >
                {item.replies} replies
              </button>
            )}
          </div>
        </div>
        <MessageActions
          canPersist={canPersist}
          onThread={() => onThread(item)}
          onReact={() => onReact(item, defaultEmoji)}
        />
      </article>
    );
  }

  if (item.type === "agent") {
    return (
      <article className="group relative mx-4 my-2 border bg-card">
        <div className="flex gap-3 p-3">
          <Avatar initials={item.initials} agent />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold">{item.author}</h3>
              <Badge className="agent-surface border border-[var(--color-agent)]">
                Agent
              </Badge>
              <Badge className="success-surface text-[var(--color-success)]">
                <Check className="size-3" />
                {item.status}
              </Badge>
              <span className="text-xs text-muted-foreground">{item.time}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{item.role}</p>
            <p className="mt-2 text-sm leading-5">{item.body}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Confidence{" "}
                <strong className="text-foreground">{item.confidence}%</strong>
              </span>
              <span>
                Evidence{" "}
                <strong className="text-foreground">{item.evidence}</strong>
              </span>
              <span>
                Human review{" "}
                <strong className="text-[var(--color-success)]">
                  Complete
                </strong>
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {item.tools.map((tool) => (
                <code
                  key={tool}
                  className="rounded border bg-background/50 px-1.5 py-0.5 text-xs"
                >
                  {tool}
                </code>
              ))}
            </div>
          </div>
        </div>
        <MessageActions
          canPersist={canPersist}
          onThread={() => onThread(item)}
          onReact={() => onReact(item, defaultEmoji)}
        />
      </article>
    );
  }

  const isApproval = item.type === "approval";
  return (
    <article
      className={cn(
        "group relative mx-4 my-2 border bg-card",
        isApproval && "border-[var(--color-warning)] approval-surface",
      )}
    >
      <div className="flex gap-3 p-3">
        <div
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-md border",
            item.type === "finding"
              ? "severity-critical"
              : isApproval
                ? "text-[var(--color-warning)]"
                : "active-indicator",
          )}
        >
          {isApproval ? (
            <ShieldCheck className="size-4" />
          ) : item.type === "case" ? (
            <Hash className="size-4" />
          ) : (
            <CircleCheck className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {"severity" in item && item.severity && (
              <SeverityBadge severity={item.severity} />
            )}
            <h3 className="text-sm font-bold">{item.title}</h3>
            <span className="text-xs text-muted-foreground">{item.time}</span>
          </div>
          <p className="mt-2 text-sm leading-5 text-[var(--color-ink-2)]">
            {item.body}
          </p>
          {"meta" in item && (
            <p className="mono mt-2 text-xs text-muted-foreground">
              {item.meta}
            </p>
          )}
          {isApproval && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled
                title="Approval actions are not available yet"
              >
                <Check />
                Approve isolation
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled
                title="Approval actions are not available yet"
              >
                Reject
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled
                title="Evidence review is not available yet"
              >
                Review evidence
              </Button>
            </div>
          )}
        </div>
      </div>
      <MessageActions
        canPersist={canPersist}
        onThread={() => onThread(item)}
        onReact={() => onReact(item, defaultEmoji)}
      />
    </article>
  );
}

function RoomDetailsPanel({ slug }: { slug: string }) {
  const directRoom = demoDirectRooms.find((room) => room.slug === slug);

  if (directRoom) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-12 items-center border-b px-3">
          <h2 className="text-xs font-bold">Conversation details</h2>
        </div>
        <div className="p-4">
          <div className="flex items-center gap-3">
            <Avatar initials={directRoom.initials} agent={directRoom.agent} />
            <div>
              <p className="text-sm font-bold">{directRoom.name}</p>
              <p className="text-xs text-muted-foreground">
                {directRoom.topic}
              </p>
            </div>
          </div>
          <p className="mt-4 border-t pt-4 text-xs leading-5 text-muted-foreground">
            {directRoom.agent
              ? "Permission-scoped agent. Tool use, learned skills and self-improvement notes remain auditable."
              : "Direct messages remain organisation-scoped and searchable."}
          </p>
        </div>
      </div>
    );
  }

  if (!demoMode) {
    const members = [demoPeople[0], ...demoAgents].flatMap((member) =>
      member ? [member] : [],
    );
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-12 items-center border-b px-3">
          <h2 className="text-xs font-bold">Room details</h2>
        </div>
        <div className="p-4 text-xs">
          <p className="font-bold">Members</p>
          <div className="mt-3 space-y-2">
            {members.map((member) => (
              <div key={member.id} className="flex items-center gap-2">
                <Avatar
                  initials={member.initials}
                  agent={"runtime" in member}
                  size="sm"
                />
                <span>{member.name}</span>
                {"runtime" in member && (
                  <Badge className="agent-surface ml-auto">Agent</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center border-b px-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-bold">Investigation</h2>
          <p className="mono truncate text-xs text-muted-foreground">
            {activeInvestigation.number}
          </p>
        </div>
        <Badge className="success-surface text-[var(--color-success)]">
          Open
        </Badge>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
        <section className="border-b pb-3">
          <p className="mb-2 font-bold">Linked signals</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-3.5 text-[var(--color-critical)]" />
              <span className="mono flex-1">ALT-2026-1042</span>
              <SeverityBadge severity="critical" />
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-3.5 text-[var(--color-high)]" />
              <span className="mono flex-1">ALT-2026-1041</span>
              <SeverityBadge severity="high" />
            </div>
          </div>
        </section>
        <section className="border-b py-3">
          <p className="mb-2 font-bold">Key observables</p>
          <div className="space-y-2 text-foreground">
            <p className="mono">203.0.113.44</p>
            <p className="mono">cdn-auth-check.example</p>
            <p className="mono">WS-1042 · jsmith</p>
          </div>
        </section>
        <section className="border-b py-3">
          <p className="mb-2 font-bold">Linked case</p>
          <p className="mono text-[var(--color-accent)]">
            {activeInvestigation.linkedCase}
          </p>
          <p className="mt-1 leading-4 text-muted-foreground">
            Kelpie remains authoritative for formal case lifecycle.
          </p>
        </section>
        <section className="py-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-bold">Room members</p>
            <span className="text-muted-foreground">18</span>
          </div>
          <div className="space-y-2">
            {[
              demoPeople[1]!,
              demoPeople[0]!,
              demoAgents[0]!,
              demoAgents[1]!,
            ].map((member) => (
              <div key={member.id} className="flex items-center gap-2">
                <Avatar
                  initials={member.initials}
                  agent={"runtime" in member}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate">{member.name}</span>
                {"runtime" in member && (
                  <Badge className="agent-surface px-1 text-xs">Agent</Badge>
                )}
                <span className="size-1.5 rounded-full bg-[var(--color-success)]" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function ThreadPanel({
  parent,
  messages,
  roomId,
  onClose,
  onReply,
}: {
  parent: TimelineItem;
  messages: RoomMessageRecord[];
  roomId: string;
  onClose?: () => void;
  onReply: (message: RoomMessageRecord) => void;
}) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const replies = messages
    .filter((message) => message.threadParentId === parent.id)
    .sort(
      (left, right) =>
        new Date(left.createdAt).getTime() -
        new Date(right.createdAt).getTime(),
    );
  const parentAuthor =
    "author" in parent
      ? parent.author
      : "title" in parent
        ? parent.title
        : "Muster";
  const parentInitials =
    "initials" in parent
      ? parent.initials
      : parentAuthor.slice(0, 2).toUpperCase();

  async function sendReply() {
    const plainText = reply.trim();
    if (!plainText || sending) return;
    setSending(true);
    try {
      const response = await fetch(`/api/v1/rooms/${roomId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadParentId: parent.id,
          document: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: plainText }],
              },
            ],
          },
          plainText,
          messageType: "text",
          dataClassification: "internal",
          idempotencyKey: browserUuid(),
        }),
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { data: RoomMessageRecord };
      onReply(payload.data);
      setReply("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 border-b px-3">
        <MessageSquare className="size-4" />
        <h2 className="flex-1 font-display text-sm font-bold">Thread</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close thread"
        >
          <X />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="border-b p-3">
          <div className="flex items-center gap-2">
            <Avatar initials={parentInitials} size="sm" />
            <strong className="text-xs">{parentAuthor}</strong>
            <span className="text-xs text-muted-foreground">{parent.time}</span>
          </div>
          <p className="mt-2 text-xs leading-5">{parent.body}</p>
        </div>
        {replies.map((message) => {
          const actor = actorIdentity[message.authorActorId] ?? {
            name: "Jordan Blake",
            initials: "JB",
            agent: false,
          };
          return (
            <div
              key={message.id}
              className="flex gap-2 border-b p-3"
              data-dynamic-message={
                seededThreadMessageIds.has(message.id) ? undefined : "true"
              }
            >
              <Avatar initials={actor.initials} size="sm" agent={actor.agent} />
              <div>
                <p className="text-xs font-bold">
                  {actor.name}{" "}
                  <span className="font-normal text-muted-foreground">
                    ·{" "}
                    {new Date(message.createdAt).toLocaleTimeString("en-AU", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </span>
                </p>
                <p className="mt-1 text-xs leading-5">{message.plainText}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t p-3">
        <textarea
          aria-label="Reply to thread"
          placeholder="Reply…"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void sendReply();
            }
          }}
          className="min-h-20 w-full resize-none rounded-md border bg-background p-2 text-xs outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Enter to reply · Shift+Enter for new line
          </span>
          <Button
            size="sm"
            disabled={sending || !reply.trim()}
            onClick={() => void sendReply()}
          >
            {sending ? "Replying…" : "Reply"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RoomView({ slug }: { slug: string }) {
  const [threadOpen, setThreadOpen] = useState(false);
  const [threadParent, setThreadParent] = useState<TimelineItem | null>(
    roomTimeline[1] ?? null,
  );
  const [messages, setMessages] = useState<RoomMessageRecord[]>([]);
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>(
    {},
  );
  const [liveEvents, setLiveEvents] = useState<
    Array<{ id: string; type: string }>
  >([]);
  const roomId =
    roomIdBySlug[slug] ?? roomIdBySlug["investigation-suspicious-powershell"]!;
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/rooms/${roomId}/messages`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          data: RoomMessageRecord[];
        };
        setMessages(payload.data);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [roomId]);
  useEffect(() => {
    const source = new EventSource("/api/v1/events/stream");
    source.addEventListener("update", (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as {
        type?: string;
        data?: { messageId?: string };
      };
      setLiveEvents((current) => [
        ...current,
        { id: browserUuid(), type: data.type ?? "update" },
      ]);
    });
    return () => source.close();
  }, []);

  function addMessage(message: RoomMessageRecord) {
    setMessages((current) =>
      current.some((item) => item.id === message.id)
        ? current
        : [...current, message],
    );
  }

  async function toggleReaction(
    item: TimelineItem,
    emoji: "eyes" | "check" | "thumbsup",
  ) {
    if (!persistedTimelineIds.has(item.id)) return;
    const response = await fetch(`/api/v1/messages/${item.id}/reactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emoji }),
    });
    if (!response.ok) return;
    const payload = (await response.json()) as {
      data: { count: number };
    };
    setReactionCounts((current) => ({
      ...current,
      [`${item.id}:${emoji}`]: payload.data.count,
    }));
  }

  const newRootMessages = messages
    .filter(
      (message) =>
        !message.threadParentId && !persistedTimelineIds.has(message.id),
    )
    .sort(
      (left, right) =>
        new Date(left.createdAt).getTime() -
        new Date(right.createdAt).getTime(),
    );
  const room = demoRooms.find((item) => item.slug === slug);
  const directRoom = demoDirectRooms.find((item) => item.slug === slug);
  const displayName = directRoom?.name ?? room?.name ?? slug;
  const topic =
    directRoom?.topic ?? room?.topic ?? "Security operations collaboration";
  const isDirect = Boolean(directRoom);
  const isIncident =
    slug.includes("incident") || slug.includes("investigation");
  return (
    <AppShell
      context={
        threadOpen && threadParent ? (
          <ThreadPanel
            parent={threadParent}
            messages={messages}
            roomId={roomId}
            onReply={addMessage}
            onClose={() => setThreadOpen(false)}
          />
        ) : (
          <RoomDetailsPanel slug={slug} />
        )
      }
    >
      <header className="border-b">
        <div className="flex min-h-12 items-center gap-2 px-4">
          {directRoom ? (
            <Avatar
              initials={directRoom.initials}
              agent={directRoom.agent}
              size="sm"
            />
          ) : (
            <Hash className="size-4 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate font-display text-sm font-bold">
                {displayName}
              </h1>
              {directRoom?.agent && (
                <Badge className="agent-surface">Agent</Badge>
              )}
              {isIncident && <SeverityBadge severity="critical" />}
            </div>
            <p className="truncate text-xs text-muted-foreground">{topic}</p>
          </div>
          <div className="hidden -space-x-1 tablet:flex">
            {(demoMode
              ? ["MC", "PN", "JB", "TH"]
              : ["MA", "AL", "JE", "PA"]
            ).map((initials) => (
              <Avatar
                key={initials}
                initials={initials}
                agent={initials === "TH"}
                size="sm"
                className="ring-2 ring-background"
              />
            ))}
          </div>
          <Badge className="hidden tablet:inline-flex">
            {demoMode ? 18 : 4}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Search room (coming soon)"
            title="Room search is not available yet"
            disabled
          >
            <Search />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="hidden tablet:inline-flex"
            disabled
            title="Assign work to an agent from Tasks"
          >
            <Bot /> Ask agent
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Room details"
            onClick={() =>
              window.dispatchEvent(new Event("muster:open-context"))
            }
          >
            <Users />
          </Button>
        </div>
        <nav
          aria-label="Room sections"
          className="flex h-8 items-end gap-5 overflow-x-auto px-4 text-xs text-muted-foreground"
        >
          <a
            href="#room-timeline"
            className="flex h-full items-center border-b-2 border-[var(--color-accent)] font-semibold text-foreground"
          >
            Messages
          </a>
          <a
            href="#room-timeline"
            className="flex h-full items-center hover:text-foreground"
          >
            Timeline
          </a>
          <Link
            href="/search"
            className="flex h-full items-center hover:text-foreground"
          >
            Evidence
          </Link>
          <Link
            href="/approvals"
            className="flex h-full items-center hover:text-foreground"
          >
            Responses
          </Link>
          <Link
            href="/workflows"
            className="flex h-full items-center hover:text-foreground"
          >
            Playbook
          </Link>
          <button
            type="button"
            className="flex h-full items-center hover:text-foreground"
            onClick={() =>
              window.dispatchEvent(new Event("muster:open-context"))
            }
          >
            Members
          </button>
        </nav>
      </header>
      <div
        id="room-timeline"
        className="scroll-region min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-5xl py-3">
          {(roomTimeline.length > 0 || newRootMessages.length > 0) && (
            <div className="mb-2 flex items-center gap-2 px-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Clock3 className="size-3" /> Today
            </div>
          )}
          {roomTimeline.map((item) => (
            <TimelineEntry
              key={item.id}
              item={item}
              reactionCounts={reactionCounts}
              onReact={(selected, emoji) =>
                void toggleReaction(selected, emoji)
              }
              onThread={(selected) => {
                setThreadParent(selected);
                setThreadOpen(true);
                window.dispatchEvent(new Event("muster:open-context"));
              }}
            />
          ))}
          {newRootMessages.map((message) => (
            <article
              key={message.id}
              className="group relative flex gap-3 px-4 py-3 hover:bg-muted/50"
              data-dynamic-message="true"
            >
              <Avatar initials={demoMode ? "JB" : "MA"} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-bold">
                    {demoMode ? "Jordan Blake" : "Muster Administrator"}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {demoMode ? "Security Lead" : "Administrator"} ·{" "}
                    {new Date(message.createdAt).toLocaleTimeString("en-AU", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </span>
                </div>
                <p className="message-prose mt-1 whitespace-pre-wrap text-sm leading-5 text-[var(--color-ink-2)]">
                  {message.plainText}
                </p>
              </div>
            </article>
          ))}
          {liveEvents.map((event) => (
            <div
              key={event.id}
              data-testid="live-event"
              className="mx-4 my-2 flex items-center gap-2 border border-[var(--color-success)] bg-[var(--color-success-soft)] p-3 text-xs"
            >
              <Check className="size-4 text-[var(--color-success)]" />
              <strong>Live update received</strong>
              <span className="mono text-muted-foreground">{event.type}</span>
            </div>
          ))}
          {!demoMode &&
            roomTimeline.length === 0 &&
            newRootMessages.length === 0 && (
              <div className="mx-auto mt-16 max-w-md px-6 text-center">
                <Hash className="mx-auto size-7 text-muted-foreground" />
                <h2 className="mt-3 text-sm font-bold">
                  Start the conversation
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Messages, agent work, decisions, and security events posted
                  here become the durable room history.
                </p>
              </div>
            )}
          {demoMode && (
            <div className="mx-4 mt-3 flex items-center gap-2 rounded border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-2 text-xs">
              <Bot className="size-4 text-[var(--color-agent)]" />
              <span className="flex-1">
                <strong>Detection Engineering Agent</strong> is drafting Sigma
                and KQL proposals…
              </span>
              <Badge className="agent-surface">Running · 01:18</Badge>
            </div>
          )}
        </div>
      </div>
      <RoomComposer
        roomSlug={slug}
        roomLabel={isDirect ? displayName : `#${displayName}`}
        onSent={addMessage}
      />
    </AppShell>
  );
}
