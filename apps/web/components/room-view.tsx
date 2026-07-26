"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bookmark,
  Bot,
  ChevronDown,
  Check,
  CircleCheck,
  Clock3,
  Copy,
  Edit3,
  Hash,
  MessageSquare,
  MoreHorizontal,
  Pin,
  Search,
  SmilePlus,
  ShieldCheck,
  Trash2,
  Users,
  WifiOff,
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
type ThreadParent = TimelineItem | RoomMessageRecord;

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
            <p className="text-sm font-bold">{item.author}</p>
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
              <p className="text-sm font-bold">{item.author}</p>
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
            <p className="text-sm font-bold">{item.title}</p>
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

const reactionLabels: Record<string, string> = {
  eyes: "Reviewing",
  check: "Agreed",
  thumbsup: "Thumbs up",
  heart: "Support",
  tada: "Celebrate",
  warning: "Needs attention",
};

function MessageText({ text }: { text: string }) {
  const parts = text.split(/([@#][a-z0-9._-]+)/gi);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("@") || part.startsWith("#") ? (
          <span
            key={`${part}-${index}`}
            className="rounded bg-[var(--color-accent-soft)] px-0.5 font-semibold text-[var(--color-accent)]"
          >
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

const structuredMessageLabels: Record<string, string> = {
  system: "System activity",
  alert: "Security alert",
  finding: "Investigation finding",
  decision: "Recorded decision",
  approval: "Approval record",
  workflow: "Workflow activity",
  "agent-status": "Agent status",
  "query-result": "Query result",
  evidence: "Evidence record",
  "case-event": "Case activity",
  "response-action": "Response action",
};

function StructuredMessageCard({
  message,
  type,
}: {
  message: RoomMessageRecord;
  type: string;
}) {
  const references = [
    message.relatedAlertId && ["Alert", message.relatedAlertId],
    message.relatedInvestigationId && [
      "Investigation",
      message.relatedInvestigationId,
    ],
    message.relatedCaseId && ["Case", message.relatedCaseId],
    message.relatedAgentRunId && ["Agent run", message.relatedAgentRunId],
    message.relatedWorkflowRunId && [
      "Workflow run",
      message.relatedWorkflowRunId,
    ],
  ].filter((entry): entry is string[] => Boolean(entry));

  return (
    <div className="mt-2 border bg-[var(--color-paper-2)] p-3">
      <div className="flex items-center gap-2">
        {type === "alert" || type === "response-action" ? (
          <AlertTriangle className="size-4 text-[var(--color-high)]" />
        ) : (
          <ShieldCheck className="size-4 text-[var(--color-accent)]" />
        )}
        <strong className="text-xs uppercase tracking-wide">
          {structuredMessageLabels[type] ?? type.replaceAll("-", " ")}
        </strong>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-5">
        <MessageText text={message.plainText} />
      </p>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer font-semibold text-[var(--color-accent)]">
          Record details
        </summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-2">
          <dt className="text-muted-foreground">Type</dt>
          <dd>{structuredMessageLabels[type] ?? type}</dd>
          <dt className="text-muted-foreground">Classification</dt>
          <dd>{message.dataClassification ?? "internal"}</dd>
          {references.map(([label, value]) => (
            <Fragment key={`${label}-${value}`}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="mono break-all">{value}</dd>
            </Fragment>
          ))}
        </dl>
      </details>
    </div>
  );
}

function DynamicMessageEntry({
  message,
  onChange,
  onThread,
}: {
  message: RoomMessageRecord;
  onChange: (message: RoomMessageRecord) => void;
  onThread: (message: RoomMessageRecord) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.plainText);
  const [actionError, setActionError] = useState<string | null>(null);
  const isAgent = message.authorType === "agent";
  const structured =
    message.messageType && message.messageType !== "text"
      ? message.messageType
      : null;
  const authorName =
    message.authorName ?? (demoMode ? "Jordan Blake" : "Muster Administrator");
  const initials = authorName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();

  async function react(emoji: keyof typeof reactionLabels) {
    setActionError(null);
    const response = await fetch(`/api/v1/messages/${message.id}/reactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emoji, idempotencyKey: browserUuid() }),
    });
    if (!response.ok) {
      setActionError("Reaction failed");
      return;
    }
    const payload = (await response.json()) as {
      data: { active: boolean; count: number };
    };
    const current = message.reactions ?? [];
    onChange({
      ...message,
      reactions: [
        ...current.filter((reaction) => reaction.emoji !== emoji),
        ...(payload.data.count > 0
          ? [
              {
                emoji,
                count: payload.data.count,
                reactedByMe: payload.data.active,
              },
            ]
          : []),
      ],
    });
    setReactionPickerOpen(false);
  }

  async function setAction(
    action: "save" | "pin" | "follow_thread",
    active: boolean,
  ) {
    setActionError(null);
    setMenuOpen(false);
    const response = await fetch(`/api/v1/messages/${message.id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        active,
        idempotencyKey: browserUuid(),
      }),
    });
    if (!response.ok) {
      setActionError(`${action.replaceAll("_", " ")} failed`);
      return;
    }
    onChange({
      ...message,
      ...(action === "save" ? { saved: active } : {}),
      ...(action === "pin" ? { pinned: active } : {}),
      ...(action === "follow_thread" ? { following: active } : {}),
    });
  }

  async function saveEdit() {
    const plainText = editText.trim();
    if (!plainText) return;
    setActionError(null);
    const response = await fetch(`/api/v1/messages/${message.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        plainText,
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: plainText }],
            },
          ],
        },
        idempotencyKey: browserUuid(),
      }),
    });
    if (!response.ok) {
      setActionError("Edit failed");
      return;
    }
    const payload = (await response.json()) as {
      data: RoomMessageRecord;
    };
    onChange({ ...message, ...payload.data });
    setEditing(false);
  }

  async function deleteMessage() {
    if (
      !window.confirm("Delete this message? Its revision history is retained.")
    ) {
      return;
    }
    setActionError(null);
    const response = await fetch(`/api/v1/messages/${message.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: browserUuid() }),
    });
    if (!response.ok) {
      setActionError("Delete failed");
      return;
    }
    const payload = (await response.json()) as {
      data: RoomMessageRecord;
    };
    onChange({ ...message, ...payload.data });
    setMenuOpen(false);
  }

  async function copyLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("message", message.id);
    await navigator.clipboard.writeText(url.toString());
    setMenuOpen(false);
  }

  return (
    <article
      id={`message-${message.id}`}
      className={cn(
        "group relative mx-1 flex gap-3 px-3 py-3 hover:bg-muted/50",
        !menuOpen &&
          !reactionPickerOpen &&
          !editing &&
          "[contain-intrinsic-size:0_72px] [content-visibility:auto]",
        structured && "my-2 border bg-card",
        message.deliveryState === "failed" &&
          "ring-1 ring-inset ring-[var(--color-error)]",
        message.unread && "bg-[var(--color-accent-soft)]/40",
      )}
      data-dynamic-message="true"
      data-delivery-state={message.deliveryState ?? "delivered"}
    >
      <Avatar initials={initials || "MA"} agent={isAgent} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="text-sm font-bold">{authorName}</p>
          {isAgent && <Badge className="agent-surface">Agent</Badge>}
          {structured && (
            <Badge className="uppercase">
              {structured.replaceAll("-", " ")}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {new Date(message.createdAt).toLocaleTimeString("en-AU", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </span>
          {message.editedAt && (
            <span className="text-xs text-muted-foreground">(edited)</span>
          )}
          {message.pinned && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Pin className="size-3" /> Pinned
            </span>
          )}
          {message.deliveryState === "pending" && (
            <span className="text-xs text-muted-foreground">Sending…</span>
          )}
          {message.deliveryState === "failed" && (
            <span role="alert" className="text-xs text-[var(--color-error)]">
              Failed · use Retry in the composer
            </span>
          )}
        </div>
        {editing ? (
          <div className="mt-2">
            <textarea
              aria-label="Edit message"
              className="min-h-20 w-full rounded border bg-background p-2 text-sm"
              value={editText}
              onChange={(event) => setEditText(event.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => void saveEdit()}>
                Save changes
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : structured ? (
          <StructuredMessageCard message={message} type={structured} />
        ) : (
          <p
            className={cn(
              "message-prose mt-1 whitespace-pre-wrap text-sm leading-5 text-[var(--color-ink-2)]",
              message.deletedAt && "italic text-muted-foreground",
            )}
          >
            <MessageText text={message.plainText} />
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {(message.reactions ?? []).map((reaction) => (
            <button
              key={reaction.emoji}
              className={cn(
                "rounded border bg-muted px-2 py-0.5 text-xs",
                reaction.reactedByMe &&
                  "border-[var(--color-accent)] bg-[var(--color-accent-soft)]",
              )}
              aria-label={`${reactionLabels[reaction.emoji] ?? reaction.emoji}, ${reaction.count}`}
              aria-pressed={reaction.reactedByMe}
              onClick={() =>
                void react(reaction.emoji as keyof typeof reactionLabels)
              }
            >
              {reactionLabels[reaction.emoji] ?? reaction.emoji} ·{" "}
              {reaction.count}
            </button>
          ))}
          {(message.replyCount ?? 0) > 0 && (
            <button
              className="text-xs font-semibold text-[var(--color-accent)]"
              onClick={() => onThread(message)}
            >
              {message.replyCount}{" "}
              {message.replyCount === 1 ? "reply" : "replies"}
            </button>
          )}
          {message.following && (
            <span className="text-xs text-muted-foreground">
              Following thread
            </span>
          )}
        </div>
        {actionError && (
          <p role="alert" className="mt-2 text-xs text-[var(--color-error)]">
            {actionError}
          </p>
        )}
      </div>
      {!message.id.startsWith("client:") && !message.deletedAt && (
        <div className="absolute right-3 top-1 flex items-center rounded border bg-popover p-0.5 opacity-0 shadow-sm group-hover:opacity-100 group-focus-within:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 min-h-7"
            aria-label="Add reaction"
            aria-expanded={reactionPickerOpen}
            onClick={() => setReactionPickerOpen((open) => !open)}
          >
            <SmilePlus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 min-h-7"
            aria-label="Open thread"
            onClick={() => onThread(message)}
          >
            <MessageSquare />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 min-h-7"
            aria-label="More message actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal />
          </Button>
          {reactionPickerOpen && (
            <div
              role="menu"
              aria-label="Reactions"
              className="absolute right-0 top-9 z-20 flex rounded border bg-popover p-1 shadow-lg"
            >
              {Object.entries(reactionLabels).map(([emoji, label]) => (
                <button
                  key={emoji}
                  role="menuitem"
                  className="rounded px-2 py-1 text-xs hover:bg-muted focus:bg-muted"
                  onClick={() =>
                    void react(emoji as keyof typeof reactionLabels)
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {menuOpen && (
            <div
              role="menu"
              aria-label="Message actions"
              className="absolute right-0 top-9 z-20 min-w-44 rounded border bg-popover p-1 text-xs shadow-lg"
            >
              <button
                role="menuitem"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
                onClick={() => void setAction("save", !message.saved)}
              >
                <Bookmark className="size-3.5" />
                {message.saved ? "Remove from saved" : "Save message"}
              </button>
              {message.canPin && (
                <button
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
                  onClick={() => void setAction("pin", !message.pinned)}
                >
                  <Pin className="size-3.5" />
                  {message.pinned ? "Unpin" : "Pin to room"}
                </button>
              )}
              <button
                role="menuitem"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
                onClick={() =>
                  void setAction("follow_thread", !message.following)
                }
              >
                <MessageSquare className="size-3.5" />
                {message.following ? "Unfollow thread" : "Follow thread"}
              </button>
              <button
                role="menuitem"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
                onClick={() => void copyLink()}
              >
                <Copy className="size-3.5" /> Copy link
              </button>
              {message.canEdit && (
                <>
                  <button
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
                    onClick={() => {
                      setEditing(true);
                      setMenuOpen(false);
                    }}
                  >
                    <Edit3 className="size-3.5" /> Edit
                  </button>
                  <button
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[var(--color-error)] hover:bg-muted"
                    onClick={() => void deleteMessage()}
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function RoomDetailsPanel({ slug }: { slug: string }) {
  const directRoom = demoDirectRooms.find((room) => room.slug === slug);
  const roomId =
    roomIdBySlug[slug] ?? roomIdBySlug["investigation-suspicious-powershell"]!;

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
          <RoomNotificationPreferences roomId={roomId} />
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
          <RoomNotificationPreferences roomId={roomId} />
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
        <RoomNotificationPreferences roomId={roomId} />
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

function RoomNotificationPreferences({ roomId }: { roomId: string }) {
  const [level, setLevel] = useState<"all" | "mentions" | "nothing">("all");
  const [muted, setMuted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/rooms/${roomId}/notifications`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          data: {
            notificationLevel: "all" | "mentions" | "nothing";
            muted: boolean;
          };
        };
        setLevel(payload.data.notificationLevel);
        setMuted(payload.data.muted);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [roomId]);

  async function save(
    notificationLevel: "all" | "mentions" | "nothing",
    nextMuted: boolean,
  ) {
    setSaving(true);
    try {
      const response = await fetch(`/api/v1/rooms/${roomId}/notifications`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationLevel, muted: nextMuted }),
      });
      if (!response.ok) return;
      setLevel(notificationLevel);
      setMuted(nextMuted);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-4 border-b pb-4 text-xs">
      <label className="font-bold" htmlFor={`room-notifications-${roomId}`}>
        Notifications
      </label>
      <select
        id={`room-notifications-${roomId}`}
        className="mt-2 h-9 w-full rounded border bg-background px-2"
        value={level}
        disabled={saving}
        onChange={(event) =>
          void save(event.target.value as "all" | "mentions" | "nothing", muted)
        }
      >
        <option value="all">All room activity</option>
        <option value="mentions">Mentions and replies</option>
        <option value="nothing">Nothing</option>
      </select>
      <label className="mt-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={muted}
          disabled={saving}
          onChange={(event) => void save(level, event.target.checked)}
        />
        Mute this room
      </label>
    </section>
  );
}

function ThreadPanel({
  parent,
  messages,
  roomId,
  onClose,
  onReply,
}: {
  parent: ThreadParent;
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
    "authorName" in parent && parent.authorName
      ? parent.authorName
      : "author" in parent
        ? parent.author
        : "title" in parent
          ? parent.title
          : "Muster";
  const parentInitials =
    "initials" in parent
      ? parent.initials
      : parentAuthor.slice(0, 2).toUpperCase();
  const parentBody = "plainText" in parent ? parent.plainText : parent.body;
  const parentTime =
    "createdAt" in parent
      ? new Date(parent.createdAt).toLocaleTimeString("en-AU", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : parent.time;

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
            <span className="text-xs text-muted-foreground">{parentTime}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-5">
            {parentBody}
          </p>
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
                {message.editedAt && (
                  <span className="text-xs text-muted-foreground">
                    (edited)
                  </span>
                )}
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
              !event.nativeEvent.isComposing &&
              !window.matchMedia("(pointer: coarse)").matches
            ) {
              event.preventDefault();
              void sendReply();
            }
          }}
          className="min-h-20 w-full resize-none rounded-md border bg-background p-2 text-xs outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Enter to reply on desktop · Shift+Enter for new line
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
  const [threadParent, setThreadParent] = useState<ThreadParent | null>(
    roomTimeline[1] ?? null,
  );
  const [messages, setMessages] = useState<RoomMessageRecord[]>([]);
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>(
    {},
  );
  const [liveEvents, setLiveEvents] = useState<
    Array<{ id: string; type: string }>
  >([]);
  const [typingActors, setTypingActors] = useState<string[]>([]);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [roomQuery, setRoomQuery] = useState("");
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pageInfo, setPageInfo] = useState<{
    hasMore: boolean;
    nextBefore: string | null;
  }>({ hasMore: false, nextBefore: null });
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const loadedOlderRef = useRef(false);
  const restoredScrollRoomRef = useRef<string | null>(null);
  const typingTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const roomId =
    roomIdBySlug[slug] ?? roomIdBySlug["investigation-suspicious-powershell"]!;

  const refreshMessages = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `/api/v1/rooms/${roomId}/messages`,
        signal ? { signal } : undefined,
      );
      if (!response.ok) return;
      const payload = (await response.json()) as {
        data: RoomMessageRecord[];
        page: { hasMore: boolean; nextBefore: string | null };
      };
      setMessages((current) => {
        const serverIds = new Set(payload.data.map((message) => message.id));
        const serverKeys = new Set(
          payload.data.flatMap(({ idempotencyKey }) =>
            idempotencyKey ? [idempotencyKey] : [],
          ),
        );
        const retained = current.filter(
          (message) =>
            !serverIds.has(message.id) &&
            ((message.id.startsWith("client:") &&
              (!message.idempotencyKey ||
                !serverKeys.has(message.idempotencyKey)) &&
              message.deliveryState !== "delivered") ||
              message.roomId === roomId),
        );
        return [...payload.data, ...retained].sort(
          (left, right) =>
            new Date(left.createdAt).getTime() -
            new Date(right.createdAt).getTime(),
        );
      });
      if (!loadedOlderRef.current) setPageInfo(payload.page);
      const latest = payload.data.at(-1);
      if (latest) {
        void fetch(`/api/v1/rooms/${roomId}/read`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageId: latest.id }),
        }).catch(() => undefined);
      }
    },
    [roomId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setMessages([]);
    setPageInfo({ hasMore: false, nextBefore: null });
    loadedOlderRef.current = false;
    restoredScrollRoomRef.current = null;
    void refreshMessages(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [refreshMessages]);

  useEffect(() => {
    if (
      messages.length === 0 ||
      restoredScrollRoomRef.current === slug ||
      !timelineRef.current
    ) {
      return;
    }
    restoredScrollRoomRef.current = slug;
    const stored = sessionStorage.getItem(`muster:room-scroll:${slug}`);
    if (!stored) return;
    const scrollTop = Number(stored);
    if (!Number.isFinite(scrollTop)) return;
    requestAnimationFrame(() =>
      timelineRef.current?.scrollTo({ top: scrollTop }),
    );
  }, [messages, slug]);

  useEffect(() => {
    const messageId = new URL(window.location.href).searchParams.get("message");
    if (!messageId || messages.length === 0) return;
    requestAnimationFrame(() => {
      document
        .getElementById(`message-${messageId}`)
        ?.scrollIntoView({ block: "center" });
    });
  }, [messages]);

  useEffect(() => {
    const source = new EventSource("/api/v1/events/stream");
    source.addEventListener("connected", () => setRealtimeConnected(true));
    source.addEventListener("update", (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as {
        type?: string;
        data?: {
          messageId?: string;
          roomId?: string;
          actorId?: string;
          active?: boolean;
        };
      };
      if (data.data?.roomId && data.data.roomId !== roomId) return;
      if (data.type === "room.typing" && data.data?.actorId) {
        const actorId = data.data.actorId;
        const existing = typingTimersRef.current.get(actorId);
        if (existing) clearTimeout(existing);
        if (data.data.active) {
          setTypingActors((current) =>
            current.includes(actorId) ? current : [...current, actorId],
          );
          typingTimersRef.current.set(
            actorId,
            setTimeout(() => {
              setTypingActors((current) =>
                current.filter((candidate) => candidate !== actorId),
              );
              typingTimersRef.current.delete(actorId);
            }, 4_000),
          );
        } else {
          setTypingActors((current) =>
            current.filter((candidate) => candidate !== actorId),
          );
          typingTimersRef.current.delete(actorId);
        }
        return;
      }
      setLiveEvents((current) => [
        ...current.slice(-4),
        { id: browserUuid(), type: data.type ?? "update" },
      ]);
      if (data.type?.startsWith("room.")) {
        void refreshMessages().catch(() => undefined);
      }
    });
    source.onerror = () => setRealtimeConnected(false);
    return () => {
      source.close();
      for (const timer of typingTimersRef.current.values()) clearTimeout(timer);
      typingTimersRef.current.clear();
    };
  }, [refreshMessages, roomId]);

  function changeMessage(message: RoomMessageRecord) {
    setMessages((current) =>
      current.some((item) => item.id === message.id)
        ? current.map((item) => (item.id === message.id ? message : item))
        : [...current, message].sort(
            (left, right) =>
              new Date(left.createdAt).getTime() -
              new Date(right.createdAt).getTime(),
          ),
    );
  }

  function handleDelivery(message: RoomMessageRecord) {
    setMessages((current) => {
      const withoutClient = current.filter(
        (item) =>
          item.id !== message.clientId &&
          item.id !== message.id &&
          (!message.idempotencyKey ||
            item.idempotencyKey !== message.idempotencyKey),
      );
      return [...withoutClient, message].sort(
        (left, right) =>
          new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime(),
      );
    });
  }

  async function loadOlderMessages() {
    if (loadingOlder || !pageInfo.hasMore || !pageInfo.nextBefore) return;
    setLoadingOlder(true);
    const timeline = timelineRef.current;
    const previousHeight = timeline?.scrollHeight ?? 0;
    try {
      const response = await fetch(
        `/api/v1/rooms/${roomId}/messages?before=${encodeURIComponent(pageInfo.nextBefore)}`,
      );
      if (!response.ok) return;
      const payload = (await response.json()) as {
        data: RoomMessageRecord[];
        page: { hasMore: boolean; nextBefore: string | null };
      };
      setMessages((current) => {
        const byId = new Map(
          [...payload.data, ...current].map((message) => [message.id, message]),
        );
        return Array.from(byId.values()).sort(
          (left, right) =>
            new Date(left.createdAt).getTime() -
            new Date(right.createdAt).getTime(),
        );
      });
      loadedOlderRef.current = true;
      setPageInfo(payload.page);
      requestAnimationFrame(() => {
        if (!timeline) return;
        timeline.scrollTop += timeline.scrollHeight - previousHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  function openThread(parent: ThreadParent) {
    setThreadParent(parent);
    setThreadOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.set("thread", parent.id);
    window.history.pushState({}, "", url);
    window.dispatchEvent(new Event("muster:open-context"));
  }

  function closeThread() {
    setThreadOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("thread");
    window.history.pushState({}, "", url);
  }

  useEffect(() => {
    function restoreThreadFromUrl() {
      const id = new URL(window.location.href).searchParams.get("thread");
      if (!id) {
        setThreadOpen(false);
        return;
      }
      const parent =
        messages.find((message) => message.id === id) ??
        roomTimeline.find((message) => message.id === id);
      if (parent) {
        setThreadParent(parent);
        setThreadOpen(true);
        window.dispatchEvent(new Event("muster:open-context"));
      }
    }
    restoreThreadFromUrl();
    window.addEventListener("popstate", restoreThreadFromUrl);
    return () => window.removeEventListener("popstate", restoreThreadFromUrl);
  }, [messages]);

  async function toggleReaction(
    item: TimelineItem,
    emoji: "eyes" | "check" | "thumbsup",
  ) {
    if (!persistedTimelineIds.has(item.id)) return;
    const response = await fetch(`/api/v1/messages/${item.id}/reactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emoji, idempotencyKey: browserUuid() }),
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
  const visibleRootMessages = roomQuery.trim()
    ? newRootMessages.filter((message) =>
        message.plainText.toLowerCase().includes(roomQuery.toLowerCase()),
      )
    : newRootMessages;
  const firstUnreadId = visibleRootMessages.find(
    (message) => message.unread,
  )?.id;
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
            onReply={changeMessage}
            onClose={closeThread}
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
          <span
            className="hidden items-center gap-1 text-xs text-muted-foreground tablet:inline-flex"
            title={
              realtimeConnected
                ? "Live room updates connected"
                : "Live updates reconnecting; durable history remains available"
            }
          >
            {realtimeConnected ? (
              <span className="size-1.5 rounded-full bg-[var(--color-success)]" />
            ) : (
              <WifiOff className="size-3.5" />
            )}
            {realtimeConnected ? "Live" : "Reconnecting"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Search room"
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen((open) => !open)}
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
        {searchOpen && (
          <div className="border-t px-4 py-2">
            <label className="sr-only" htmlFor="room-search">
              Search within this room
            </label>
            <input
              id="room-search"
              autoFocus
              type="search"
              value={roomQuery}
              onChange={(event) => setRoomQuery(event.target.value)}
              placeholder="Search this room"
              className="h-8 w-full rounded border bg-background px-3 text-sm outline-none focus:border-[var(--color-focus)]"
            />
          </div>
        )}
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
        ref={timelineRef}
        className="scroll-region min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => {
          const element = event.currentTarget;
          sessionStorage.setItem(
            `muster:room-scroll:${slug}`,
            String(element.scrollTop),
          );
          setShowJumpToLatest(
            element.scrollHeight - element.scrollTop - element.clientHeight >
              160,
          );
        }}
      >
        <div className="mx-auto max-w-5xl py-3">
          {pageInfo.hasMore && (
            <div className="flex justify-center px-4 pb-3">
              <Button
                size="sm"
                variant="outline"
                disabled={loadingOlder}
                onClick={() => void loadOlderMessages()}
              >
                <Clock3 />
                {loadingOlder ? "Loading…" : "Load older messages"}
              </Button>
            </div>
          )}
          {(roomTimeline.length > 0 || newRootMessages.length > 0) && (
            <div className="mb-2 flex items-center gap-2 px-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Clock3 className="size-3" /> Today
            </div>
          )}
          {roomTimeline
            .filter(
              (item) =>
                !roomQuery.trim() ||
                item.body.toLowerCase().includes(roomQuery.toLowerCase()),
            )
            .map((item) => (
              <TimelineEntry
                key={item.id}
                item={item}
                reactionCounts={reactionCounts}
                onReact={(selected, emoji) =>
                  void toggleReaction(selected, emoji)
                }
                onThread={openThread}
              />
            ))}
          {visibleRootMessages.map((message) => (
            <div key={message.id} className="relative focus-within:z-30">
              {message.id === firstUnreadId && (
                <div
                  role="separator"
                  aria-label="New messages"
                  className="my-2 flex items-center gap-2 px-4 text-xs font-semibold text-[var(--color-accent)]"
                >
                  <span className="h-px flex-1 bg-[var(--color-accent)]" />
                  New messages
                  <span className="h-px flex-1 bg-[var(--color-accent)]" />
                </div>
              )}
              <DynamicMessageEntry
                message={message}
                onChange={changeMessage}
                onThread={openThread}
              />
            </div>
          ))}
          {liveEvents.map((event) => (
            <div
              key={event.id}
              data-testid="live-event"
              className="pointer-events-none mx-4 my-2 flex items-center gap-2 border border-[var(--color-success)] bg-[var(--color-success-soft)] p-3 text-xs"
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
          {typingActors.length > 0 && (
            <div
              role="status"
              aria-live="polite"
              data-testid="typing-indicator"
              className="mx-4 mt-2 text-xs text-muted-foreground"
            >
              {typingActors.length === 1
                ? "A room member is typing…"
                : `${typingActors.length} room members are typing…`}
            </div>
          )}
        </div>
      </div>
      {showJumpToLatest && (
        <Button
          size="sm"
          variant="outline"
          className="mx-auto mb-2"
          onClick={() =>
            timelineRef.current?.scrollTo({
              top: timelineRef.current.scrollHeight,
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                .matches
                ? "auto"
                : "smooth",
            })
          }
        >
          <ChevronDown /> Jump to latest
        </Button>
      )}
      <RoomComposer
        roomSlug={slug}
        roomLabel={isDirect ? displayName : `#${displayName}`}
        onDeliveryChange={handleDelivery}
      />
    </AppShell>
  );
}
