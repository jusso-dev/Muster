"use client";

import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  FileText,
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
import { RoomAgentActivity } from "@/components/room-agent-activity";
import { RoomAgentHandoffs } from "@/components/room-agent-handoffs";
import {
  VisualReactionAsset,
  type VisualReactionAssetData,
} from "@/components/visual-reaction-asset";
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

function safeMessageHref(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function MessageDocument({ document }: { document: Record<string, unknown> }) {
  function renderNode(value: unknown, key: string): ReactNode {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const node = value as Record<string, unknown>;
    const content = Array.isArray(node.content)
      ? node.content.map((child, index) => renderNode(child, `${key}-${index}`))
      : null;

    if (node.type === "text" && typeof node.text === "string") {
      let rendered: ReactNode = <MessageText text={node.text} />;
      if (Array.isArray(node.marks)) {
        node.marks.forEach((mark, index) => {
          if (!mark || typeof mark !== "object" || Array.isArray(mark)) return;
          const typedMark = mark as Record<string, unknown>;
          const markKey = `${key}-mark-${index}`;
          if (typedMark.type === "bold")
            rendered = <strong key={markKey}>{rendered}</strong>;
          if (typedMark.type === "italic")
            rendered = <em key={markKey}>{rendered}</em>;
          if (typedMark.type === "code")
            rendered = <code key={markKey}>{rendered}</code>;
          if (
            typedMark.type === "link" &&
            typedMark.attrs &&
            typeof typedMark.attrs === "object" &&
            !Array.isArray(typedMark.attrs)
          ) {
            const href = safeMessageHref(
              (typedMark.attrs as Record<string, unknown>).href,
            );
            if (href) {
              rendered = (
                <a
                  key={markKey}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-[var(--color-accent)] underline"
                >
                  {rendered}
                </a>
              );
            }
          }
        });
      }
      return <Fragment key={key}>{rendered}</Fragment>;
    }

    switch (node.type) {
      case "doc":
        return <Fragment key={key}>{content}</Fragment>;
      case "paragraph":
        return <p key={key}>{content}</p>;
      case "heading": {
        const level =
          node.attrs &&
          typeof node.attrs === "object" &&
          !Array.isArray(node.attrs) &&
          (node.attrs as Record<string, unknown>).level === 3
            ? "h3"
            : "h2";
        return level === "h3" ? (
          <h3 key={key}>{content}</h3>
        ) : (
          <h2 key={key}>{content}</h2>
        );
      }
      case "bulletList":
        return <ul key={key}>{content}</ul>;
      case "orderedList":
        return <ol key={key}>{content}</ol>;
      case "listItem":
        return <li key={key}>{content}</li>;
      case "blockquote":
        return <blockquote key={key}>{content}</blockquote>;
      case "codeBlock":
        return (
          <pre key={key}>
            <code>{content}</code>
          </pre>
        );
      case "hardBreak":
        return <br key={key} />;
      default:
        return null;
    }
  }

  return <>{renderNode(document, "document")}</>;
}

function messageAttachments(document: Record<string, unknown> | undefined) {
  const attachments: Array<{ id: string; label: string }> = [];
  function visit(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const node = value as Record<string, unknown>;
    if (
      node.type === "attachment" &&
      node.attrs &&
      typeof node.attrs === "object" &&
      !Array.isArray(node.attrs)
    ) {
      const attrs = node.attrs as Record<string, unknown>;
      if (typeof attrs.id === "string" && typeof attrs.label === "string") {
        attachments.push({ id: attrs.id, label: attrs.label });
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  }
  visit(document);
  return attachments;
}

function messageVisualReactions(document: Record<string, unknown> | undefined) {
  const reactions: VisualReactionAssetData[] = [];
  function visit(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const node = value as Record<string, unknown>;
    if (
      node.type === "visualReaction" &&
      node.attrs &&
      typeof node.attrs === "object" &&
      !Array.isArray(node.attrs)
    ) {
      const attrs = node.attrs as Record<string, unknown>;
      if (
        typeof attrs.assetId === "string" &&
        typeof attrs.revisionId === "string" &&
        typeof attrs.sha256 === "string" &&
        typeof attrs.altText === "string" &&
        typeof attrs.frameCount === "number"
      ) {
        reactions.push({
          id: attrs.assetId,
          revisionId: attrs.revisionId,
          sha256: attrs.sha256,
          altText: attrs.altText,
          frameCount: attrs.frameCount,
        });
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  }
  visit(document);
  return reactions;
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
  const attachments = messageAttachments(message.document);
  const visualReactions = messageVisualReactions(message.document);
  const displayText = attachments
    .reduce(
      (text, attachment) =>
        text.replace(
          `${text.includes("\n") ? "\n" : ""}Evidence attachment: ${attachment.label}`,
          "",
        ),
      message.plainText,
    )
    .replace(/^\[Visual reaction: .+\]$/, "")
    .trim();
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
        ) : displayText ? (
          <div
            className={cn(
              "message-prose mt-1 whitespace-pre-wrap text-sm leading-5 text-[var(--color-ink-2)]",
              message.deletedAt && "italic text-muted-foreground",
            )}
          >
            {message.document ? (
              <MessageDocument document={message.document} />
            ) : (
              <p>
                <MessageText text={displayText} />
              </p>
            )}
          </div>
        ) : null}
        {attachments.length > 0 && (
          <div
            className="mt-2 space-y-1"
            aria-label="Governed evidence attachments"
          >
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex items-center gap-2 rounded border bg-muted px-2 py-1.5 text-xs"
              >
                <FileText className="size-3.5 text-[var(--color-accent)]" />
                <span className="min-w-0 flex-1 truncate">
                  {attachment.label}
                </span>
                <span className="text-muted-foreground">
                  Stored evidence · pending scan
                </span>
              </div>
            ))}
          </div>
        )}
        {visualReactions.length > 0 && !message.deletedAt && (
          <div
            className="mt-2 flex flex-wrap gap-2"
            aria-label="Decorative visual reaction"
          >
            {visualReactions.map((reaction) => (
              <VisualReactionAsset key={reaction.id} asset={reaction} />
            ))}
            <span className="sr-only">
              Decorative only. This reaction does not change operational state.
            </span>
          </div>
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
              {message.canEdit && visualReactions.length === 0 && (
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

type GovernedRoomDetails = {
  room: {
    id: string;
    displayName: string;
    description: string;
    topic: string;
    visibility: string;
    roomType: string;
    membershipRole: string | null;
  };
  members: Array<{
    actorId: string;
    displayName: string;
    actorType: string;
    status: string;
    role: string;
    joinedAt: string;
    accessExpiresAt: string | null;
  }>;
  agents: GovernedRoomDetails["members"];
  invitations: Array<{
    id: string;
    invitedActorId: string;
    membershipRole: string;
    status: string;
    accessExpiresAt: string | null;
  }>;
  pinned: Array<{
    id: string;
    plainText: string;
    createdAt: string;
  }>;
  files: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    size: number;
    classification: string;
    scanState: string;
    uploadedAt: string;
  }>;
  workflows: Array<{
    id: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
  }>;
  integrations: Array<{
    id: string;
    product: string;
    displayName: string;
    status: string;
  }>;
  audit: Array<{
    id: string;
    action: string;
    actorId: string;
    createdAt: string;
  }>;
};

const detailTabs = [
  "About",
  "Members",
  "Agents",
  "Pinned",
  "Files",
  "Workflows",
  "Integrations",
  "Audit",
] as const;

function GovernedDetailsPanel({ roomId }: { roomId: string }) {
  const [details, setDetails] = useState<GovernedRoomDetails | null>(null);
  const [tab, setTab] = useState<(typeof detailTabs)[number]>("About");
  const [error, setError] = useState("");
  const [directory, setDirectory] = useState<
    Array<{
      id: string;
      displayName: string;
      actorType: string;
      status: string;
    }>
  >([]);
  const [inviteActorId, setInviteActorId] = useState("");
  const [inviteRole, setInviteRole] = useState<
    "member" | "moderator" | "guest" | "agent_member"
  >("member");
  const [inviteExpiry, setInviteExpiry] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/v1/rooms/${roomId}/details`);
    if (!response.ok) {
      setError("Room details unavailable");
      return;
    }
    const payload = (await response.json()) as { data: GovernedRoomDetails };
    setDetails(payload.data);
    setError("");
  }, [roomId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (
      details?.room.membershipRole !== "owner" &&
      details?.room.membershipRole !== "moderator"
    ) {
      return;
    }
    void fetch("/api/v1/directory")
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          data: Array<{
            id: string;
            displayName: string;
            actorType: string;
            status: string;
          }>;
        };
        setDirectory(
          payload.data.filter(
            (actor) =>
              actor.status === "active" &&
              !details.members.some((member) => member.actorId === actor.id),
          ),
        );
      })
      .catch(() => undefined);
  }, [details]);

  async function inviteMember() {
    if (!inviteActorId) {
      setError("Select an actor to invite");
      return;
    }
    const response = await fetch(`/api/v1/rooms/${roomId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorIds: [inviteActorId],
        membershipRole: inviteRole,
        accessExpiresAt: inviteExpiry
          ? new Date(inviteExpiry).toISOString()
          : null,
        idempotencyKey: `member-invite:${browserUuid()}`,
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        detail?: string;
      } | null;
      setError(payload?.detail ?? "Invitation could not be created");
      return;
    }
    setInviteActorId("");
    setInviteExpiry("");
    await refresh();
  }

  async function removeMember(actorId: string) {
    const response = await fetch(`/api/v1/rooms/${roomId}/members/${actorId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `member-remove:${browserUuid()}`,
      }),
    });
    if (!response.ok) {
      setError("Member could not be removed");
      return;
    }
    await refresh();
  }

  async function transferOwnership(actorId: string) {
    const response = await fetch(`/api/v1/rooms/${roomId}/ownership`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorId,
        idempotencyKey: `ownership-transfer:${browserUuid()}`,
      }),
    });
    if (!response.ok) {
      setError("Ownership could not be transferred");
      return;
    }
    await refresh();
  }

  async function updateRoom(formData: FormData) {
    const response = await fetch(`/api/v1/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: String(formData.get("displayName") ?? ""),
        topic: String(formData.get("topic") ?? ""),
        description: String(formData.get("description") ?? ""),
        visibility: String(formData.get("visibility") ?? "organisation"),
        idempotencyKey: `room-update:${browserUuid()}`,
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        detail?: string;
      } | null;
      setError(payload?.detail ?? "Room could not be updated");
      return;
    }
    await refresh();
  }

  async function exportRoom() {
    if (!details) return;
    const response = await fetch(`/api/v1/rooms/${roomId}/export`);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        detail?: string;
      } | null;
      setError(payload?.detail ?? "Room export is unavailable");
      return;
    }
    const payload = (await response.json()) as { data: unknown };
    const blob = new Blob([JSON.stringify(payload.data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${details.room.displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")}-muster-export.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!details) {
    return (
      <div className="grid h-full place-items-center p-4 text-xs text-muted-foreground">
        {error || "Loading room details…"}
      </div>
    );
  }
  const canManage =
    details.room.membershipRole === "owner" ||
    details.room.membershipRole === "moderator";
  const records =
    tab === "Members"
      ? details.members.filter((member) => member.actorType !== "agent")
      : tab === "Agents"
        ? details.agents
        : [];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-3 py-3">
        <h2 className="truncate text-xs font-bold">
          {details.room.displayName}
        </h2>
        <p className="truncate text-xs text-muted-foreground">
          {details.room.visibility} · {details.room.roomType}
        </p>
      </div>
      <div
        role="tablist"
        aria-label="Room details"
        className="flex gap-1 overflow-x-auto border-b p-2"
      >
        {detailTabs.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={tab === candidate}
            onClick={() => setTab(candidate)}
            className={cn(
              "min-h-8 shrink-0 rounded px-2 text-xs text-muted-foreground hover:bg-muted",
              tab === candidate && "bg-muted font-semibold text-foreground",
            )}
          >
            {candidate}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
        {error && (
          <p role="alert" className="mb-3 text-[var(--color-error)]">
            {error}
          </p>
        )}
        {tab === "About" && (
          <div className="space-y-4">
            {canManage ? (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void updateRoom(new FormData(event.currentTarget));
                }}
              >
                <label className="block font-bold">
                  Name
                  <input
                    name="displayName"
                    defaultValue={details.room.displayName}
                    minLength={2}
                    maxLength={120}
                    required
                    className="mt-1 h-9 w-full rounded border bg-background px-2 font-normal"
                  />
                </label>
                <label className="block font-bold">
                  Topic
                  <input
                    name="topic"
                    defaultValue={details.room.topic}
                    maxLength={500}
                    className="mt-1 h-9 w-full rounded border bg-background px-2 font-normal"
                  />
                </label>
                <label className="block font-bold">
                  Purpose
                  <textarea
                    name="description"
                    defaultValue={details.room.description}
                    maxLength={2_000}
                    rows={3}
                    className="mt-1 w-full rounded border bg-background p-2 font-normal"
                  />
                </label>
                <label className="block font-bold">
                  Visibility
                  <select
                    name="visibility"
                    defaultValue={details.room.visibility}
                    disabled={details.room.roomType === "direct"}
                    className="mt-1 h-9 w-full rounded border bg-background px-2 font-normal"
                  >
                    <option value="organisation">Organisation</option>
                    <option value="private">Private</option>
                    <option value="restricted">Restricted</option>
                  </select>
                </label>
                <Button size="sm" type="submit">
                  Save room details
                </Button>
              </form>
            ) : (
              <>
                <section>
                  <p className="font-bold">Purpose</p>
                  <p className="mt-1 leading-5 text-muted-foreground">
                    {details.room.description || "No purpose recorded."}
                  </p>
                </section>
                <section>
                  <p className="font-bold">Topic</p>
                  <p className="mt-1 leading-5 text-muted-foreground">
                    {details.room.topic || "No topic recorded."}
                  </p>
                </section>
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void exportRoom()}
            >
              Export room manifest
            </Button>
            <RoomNotificationPreferences roomId={roomId} />
          </div>
        )}
        {(tab === "Members" || tab === "Agents") && (
          <div className="space-y-2">
            {tab === "Members" && canManage && (
              <section className="mb-3 space-y-2 rounded border bg-background p-2">
                <p className="font-bold">Invite member or agent</p>
                <label className="block">
                  <span className="sr-only">Actor</span>
                  <select
                    value={inviteActorId}
                    onChange={(event) => {
                      const actor = directory.find(
                        (candidate) => candidate.id === event.target.value,
                      );
                      setInviteActorId(event.target.value);
                      if (actor?.actorType === "agent") {
                        setInviteRole("agent_member");
                      } else if (inviteRole === "agent_member") {
                        setInviteRole("member");
                      }
                    }}
                    className="h-9 w-full rounded border bg-background px-2"
                  >
                    <option value="">Select actor</option>
                    {directory.map((actor) => (
                      <option key={actor.id} value={actor.id}>
                        {actor.displayName}
                        {actor.actorType === "agent" ? " (agent)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span className="sr-only">Role</span>
                    <select
                      value={inviteRole}
                      onChange={(event) =>
                        setInviteRole(event.target.value as typeof inviteRole)
                      }
                      className="h-9 w-full rounded border bg-background px-2"
                    >
                      <option value="member">Member</option>
                      <option value="moderator">Moderator</option>
                      <option value="guest">Guest</option>
                      <option value="agent_member">Agent member</option>
                    </select>
                  </label>
                  <label>
                    <span className="sr-only">Access expiry</span>
                    <input
                      type="datetime-local"
                      value={inviteExpiry}
                      onChange={(event) => setInviteExpiry(event.target.value)}
                      className="h-9 w-full rounded border bg-background px-2"
                    />
                  </label>
                </div>
                <Button size="sm" onClick={() => void inviteMember()}>
                  Invite
                </Button>
              </section>
            )}
            {records.map((member) => (
              <div
                key={member.actorId}
                className="rounded border bg-background p-2"
              >
                <div className="flex items-center gap-2">
                  <Avatar
                    initials={member.displayName
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((part) => part[0] ?? "")
                      .join("")
                      .toUpperCase()}
                    agent={member.actorType === "agent"}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {member.displayName}
                  </span>
                  <Badge>{member.role}</Badge>
                </div>
                {member.accessExpiresAt && (
                  <p className="mt-2 text-muted-foreground">
                    Access expires{" "}
                    {new Date(member.accessExpiresAt).toLocaleString()}
                  </p>
                )}
                {canManage && member.role !== "owner" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {member.actorType !== "agent" &&
                      member.role !== "guest" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void transferOwnership(member.actorId)}
                        >
                          Make owner
                        </Button>
                      )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void removeMember(member.actorId)}
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {records.length === 0 && (
              <p className="text-muted-foreground">No records.</p>
            )}
            {tab === "Members" && details.invitations.length > 0 && (
              <section className="mt-4 border-t pt-3">
                <p className="font-bold">Invitations</p>
                {details.invitations.map((invitation) => (
                  <p key={invitation.id} className="mt-2 text-muted-foreground">
                    {invitation.membershipRole} · {invitation.status}
                  </p>
                ))}
              </section>
            )}
          </div>
        )}
        {tab === "Pinned" && (
          <RecordList
            empty="No pinned messages."
            records={details.pinned.map((item) => ({
              id: item.id,
              title: item.plainText,
              meta: new Date(item.createdAt).toLocaleString(),
            }))}
          />
        )}
        {tab === "Files" && (
          <RecordList
            empty="No governed files."
            records={details.files.map((item) => ({
              id: item.id,
              title: item.fileName,
              meta: `${item.classification} · ${item.scanState} · ${item.size} bytes`,
            }))}
          />
        )}
        {tab === "Workflows" && (
          <RecordList
            empty="No workflow runs."
            records={details.workflows.map((item) => ({
              id: item.id,
              title: item.status,
              meta: item.startedAt
                ? new Date(item.startedAt).toLocaleString()
                : "Queued",
            }))}
          />
        )}
        {tab === "Integrations" && (
          <RecordList
            empty="No bound integrations."
            records={details.integrations.map((item) => ({
              id: item.id,
              title: item.displayName,
              meta: `${item.product} · ${item.status}`,
            }))}
          />
        )}
        {tab === "Audit" && (
          <RecordList
            empty="No room audit events."
            records={details.audit.map((item) => ({
              id: item.id,
              title: item.action,
              meta: new Date(item.createdAt).toLocaleString(),
            }))}
          />
        )}
      </div>
    </div>
  );
}

function RecordList({
  records,
  empty,
}: {
  records: Array<{ id: string; title: string; meta: string }>;
  empty: string;
}) {
  if (records.length === 0)
    return <p className="text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-2">
      {records.map((record) => (
        <div key={record.id} className="rounded border bg-background p-2">
          <p className="font-semibold">{record.title}</p>
          <p className="mt-1 text-muted-foreground">{record.meta}</p>
        </div>
      ))}
    </div>
  );
}

function RoomDetailsPanel({
  slug,
  roomId,
  governed,
}: {
  slug: string;
  roomId: string;
  governed: boolean;
}) {
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
          <RoomNotificationPreferences roomId={roomId} />
        </div>
      </div>
    );
  }

  if (governed) {
    return <GovernedDetailsPanel key={roomId} roomId={roomId} />;
  }

  if (!demoMode) {
    return (
      <div className="grid h-full place-items-center p-4 text-xs text-muted-foreground">
        Resolving governed room…
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
  const [notifyReplies, setNotifyReplies] = useState(true);
  const [notifyFollowedThreads, setNotifyFollowedThreads] = useState(true);
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
            notifyReplies: boolean;
            notifyFollowedThreads: boolean;
            muted: boolean;
          };
        };
        setLevel(payload.data.notificationLevel);
        setNotifyReplies(payload.data.notifyReplies);
        setNotifyFollowedThreads(payload.data.notifyFollowedThreads);
        setMuted(payload.data.muted);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [roomId]);

  async function save(
    notificationLevel: "all" | "mentions" | "nothing",
    nextMuted: boolean,
    nextNotifyReplies = notifyReplies,
    nextNotifyFollowedThreads = notifyFollowedThreads,
  ) {
    setSaving(true);
    try {
      const response = await fetch(`/api/v1/rooms/${roomId}/notifications`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          notificationLevel,
          muted: nextMuted,
          notifyReplies: nextNotifyReplies,
          notifyFollowedThreads: nextNotifyFollowedThreads,
        }),
      });
      if (!response.ok) return;
      setLevel(notificationLevel);
      setNotifyReplies(nextNotifyReplies);
      setNotifyFollowedThreads(nextNotifyFollowedThreads);
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
          className="size-6 shrink-0"
          checked={notifyReplies}
          disabled={saving || muted}
          onChange={(event) =>
            void save(level, muted, event.target.checked, notifyFollowedThreads)
          }
        />
        Replies to my messages
      </label>
      <label className="mt-2 flex items-center gap-2">
        <input
          type="checkbox"
          className="size-6 shrink-0"
          checked={notifyFollowedThreads}
          disabled={saving || muted}
          onChange={(event) =>
            void save(level, muted, notifyReplies, event.target.checked)
          }
        />
        Activity in followed threads
      </label>
      <label className="mt-2 flex items-center gap-2">
        <input
          type="checkbox"
          className="size-6 shrink-0"
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
  const [actionsOpen, setActionsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
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

  async function copyThread() {
    if (exporting) return;
    setExporting(true);
    setActionsOpen(false);
    setExportFeedback(null);
    try {
      const response = await fetch(
        `/api/v1/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(parent.id)}/export`,
      );
      if (!response.ok) throw new Error("Thread export failed.");
      const payload = (await response.json()) as {
        data: { markdown: string; fileName: string };
      };
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error("Clipboard unavailable.");
        }
        await navigator.clipboard.writeText(payload.data.markdown);
        setExportFeedback({
          kind: "success",
          message: "Thread copied as Markdown.",
        });
      } catch {
        const url = URL.createObjectURL(
          new Blob([payload.data.markdown], {
            type: "text/markdown;charset=utf-8",
          }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = payload.data.fileName;
        link.click();
        URL.revokeObjectURL(url);
        setExportFeedback({
          kind: "success",
          message: "Clipboard unavailable; Markdown downloaded.",
        });
      }
    } catch {
      setExportFeedback({
        kind: "error",
        message: "Thread export failed. Try again.",
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 border-b px-3">
        <MessageSquare className="size-4" />
        <h2 className="flex-1 font-display text-sm font-bold">Thread</h2>
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setActionsOpen((open) => !open)}
            aria-label="Thread actions"
            aria-expanded={actionsOpen}
            disabled={exporting}
          >
            <MoreHorizontal />
          </Button>
          {actionsOpen && (
            <div
              role="menu"
              className="absolute right-0 top-10 z-30 w-44 rounded-md border bg-popover p-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-muted"
                onClick={() => void copyThread()}
              >
                <Copy className="size-3.5" />
                Copy thread
              </button>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close thread"
        >
          <X />
        </Button>
      </div>
      {exportFeedback && (
        <div
          role={exportFeedback.kind === "error" ? "alert" : "status"}
          className={cn(
            "border-b px-3 py-2 text-xs",
            exportFeedback.kind === "error"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {exportFeedback.message}
        </div>
      )}
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
  const [presentSessions, setPresentSessions] = useState<
    Array<{ actorId: string; sessionId: string }>
  >([]);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [governedRoom, setGovernedRoom] = useState<{
    id: string;
    slug: string;
    displayName: string;
    topic: string;
    roomType: string;
  } | null>(null);
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
  const presenceTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const presenceSessionRef = useRef(browserUuid());
  const roomId =
    governedRoom?.id ??
    roomIdBySlug[slug] ??
    roomIdBySlug["investigation-suspicious-powershell"]!;
  const roomResolved = Boolean(
    governedRoom || (demoMode && roomIdBySlug[slug]),
  );

  useEffect(() => {
    if (demoMode && roomIdBySlug[slug]) return;
    const controller = new AbortController();
    const parameters = new URLSearchParams({
      q: slug.replaceAll("-", " "),
      includeArchived: "true",
    });
    void fetch(`/api/v1/rooms?${parameters}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          data: Array<{
            id: string;
            slug: string;
            displayName: string;
            topic: string;
            roomType: string;
          }>;
        };
        const exact = payload.data.find((room) => room.slug === slug);
        if (exact) setGovernedRoom(exact);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [slug]);

  const refreshMessages = useCallback(
    async (signal?: AbortSignal) => {
      if (!roomResolved) return;
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
    [roomId, roomResolved],
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
    if (!roomResolved) return;
    const source = new EventSource("/api/v1/events/stream");
    const reportPresence = (active: boolean) =>
      fetch(`/api/v1/rooms/${roomId}/presence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          active,
          sessionId: presenceSessionRef.current,
        }),
        keepalive: !active,
      }).catch(() => undefined);
    source.addEventListener("connected", () => {
      setRealtimeConnected(true);
      void reportPresence(true);
    });
    source.addEventListener("update", (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as {
        type?: string;
        data?: {
          messageId?: string;
          roomId?: string;
          actorId?: string;
          sessionId?: string;
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
      if (
        data.type === "room.presence" &&
        data.data?.actorId &&
        data.data.sessionId
      ) {
        const { actorId, sessionId } = data.data;
        const existing = presenceTimersRef.current.get(sessionId);
        if (existing) clearTimeout(existing);
        if (data.data.active) {
          setPresentSessions((current) =>
            current.some((session) => session.sessionId === sessionId)
              ? current.map((session) =>
                  session.sessionId === sessionId
                    ? { actorId, sessionId }
                    : session,
                )
              : [...current, { actorId, sessionId }],
          );
          presenceTimersRef.current.set(
            sessionId,
            setTimeout(() => {
              setPresentSessions((current) =>
                current.filter((session) => session.sessionId !== sessionId),
              );
              presenceTimersRef.current.delete(sessionId);
            }, 45_000),
          );
        } else {
          setPresentSessions((current) =>
            current.filter((session) => session.sessionId !== sessionId),
          );
          presenceTimersRef.current.delete(sessionId);
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
    const heartbeat = setInterval(() => void reportPresence(true), 25_000);
    return () => {
      void reportPresence(false);
      source.close();
      clearInterval(heartbeat);
      for (const timer of typingTimersRef.current.values()) clearTimeout(timer);
      typingTimersRef.current.clear();
      for (const timer of presenceTimersRef.current.values())
        clearTimeout(timer);
      presenceTimersRef.current.clear();
      setPresentSessions([]);
    };
  }, [refreshMessages, roomId, roomResolved]);

  const presentActorCount = new Set(
    presentSessions.map((session) => session.actorId),
  ).size;

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
  const displayName =
    governedRoom?.displayName ?? directRoom?.name ?? room?.name ?? slug;
  const topic =
    governedRoom?.topic ??
    directRoom?.topic ??
    room?.topic ??
    "Security operations collaboration";
  const isDirect = governedRoom?.roomType === "direct" || Boolean(directRoom);
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
          <RoomDetailsPanel
            slug={slug}
            roomId={roomId}
            governed={Boolean(governedRoom)}
          />
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
          {realtimeConnected && (
            <span
              className="hidden text-xs text-muted-foreground tablet:inline"
              data-testid="room-presence"
            >
              {presentActorCount} present
            </span>
          )}
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
          <RoomAgentHandoffs roomId={roomId} roomResolved={roomResolved} />
          <RoomAgentActivity
            roomId={roomId}
            roomResolved={roomResolved}
            showDemoFallback={demoMode}
          />
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
