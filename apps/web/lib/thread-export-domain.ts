import { and, asc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
import {
  hasCapability,
  requireCapability,
  type AuthorisationSubject,
} from "@muster/authz";
import { redactObservationText, TRUNCATION_MARKER } from "@muster/config";
import { appendAuditEvent, database, schema } from "@muster/database";
import { RoomService } from "@muster/rooms";
import { ApiProblem } from "./api-context";

export const THREAD_EXPORT_PAGE_SIZE = 100;
export const THREAD_EXPORT_MESSAGE_MAX = 50_000;

export type ThreadExportEntry = {
  id: string;
  threadParentId: string | null;
  authorName: string;
  authorType: string;
  messageType: string;
  document: unknown;
  plainText: string;
  createdAt: Date;
  deletedAt: Date | null;
};

export type ThreadExportEvidence = {
  id: string;
  fileName: string;
  mimeType: string;
};

type ThreadExportRoom = {
  id: string;
  slug: string;
  displayName: string;
};

const structuredLabels: Record<string, string> = {
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

function safeText(value: string, maximum: number): string {
  const limit = Math.max(1, maximum - TRUNCATION_MARKER.length);
  return redactObservationText(value, { maxStringLength: limit })
    .replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
      " ",
    )
    .replace(/\r\n?/g, "\n")
    .trim();
}

export function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()<>#+\-.!|])/g, "\\$1");
}

function attachmentIds(document: unknown): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 8 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    const node = value as Record<string, unknown>;
    if (
      node.type === "attachment" &&
      node.attrs &&
      typeof node.attrs === "object" &&
      !Array.isArray(node.attrs)
    ) {
      const id = (node.attrs as Record<string, unknown>).id;
      if (typeof id === "string") ids.add(id);
    }
    if (Array.isArray(node.content)) {
      node.content.forEach((item) => visit(item, depth + 1));
    }
  };
  visit(document, 0);
  return [...ids];
}

function quoteMarkdown(value: string): string {
  return value
    .split("\n")
    .map((line) => `> ${escapeMarkdown(line)}`)
    .join("\n");
}

export function mergeThreadPages(
  pages: ThreadExportEntry[][],
): ThreadExportEntry[] {
  const byId = new Map<string, ThreadExportEntry>();
  for (const page of pages) {
    for (const entry of page) {
      if (!entry.deletedAt) byId.set(entry.id, entry);
    }
  }
  return [...byId.values()].sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id),
  );
}

export function renderThreadMarkdown(
  room: ThreadExportRoom,
  rootMessageId: string,
  entries: ThreadExportEntry[],
  evidence: ThreadExportEvidence[],
): string {
  const merged = mergeThreadPages([entries]);
  const root = merged.find((entry) => entry.id === rootMessageId);
  if (!root) throw new Error("Thread root is unavailable.");
  const ordered = [
    root,
    ...merged.filter((entry) => entry.id !== rootMessageId),
  ];
  const safeRoomName = safeText(room.displayName, 160);
  const safeSlug = safeText(room.slug, 80);
  const safeRootText = safeText(root.plainText, THREAD_EXPORT_MESSAGE_MAX);
  const threadTitle =
    safeRootText
      .split("\n")
      .find((line) => line.trim())
      ?.slice(0, 160) ?? "Thread";
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const blocks = ordered.map((entry, index) => {
    const actor = safeText(entry.authorName, 160) || "Unknown actor";
    const actorType =
      entry.authorType === "agent"
        ? "Agent"
        : entry.authorType === "human"
          ? "Human"
          : "System";
    const text = safeText(entry.plainText, THREAD_EXPORT_MESSAGE_MAX);
    const heading = index === 0 ? "Root message" : `Reply ${index}`;
    const structured =
      entry.messageType === "text"
        ? ""
        : `\n**Entry type:** ${escapeMarkdown(
            structuredLabels[entry.messageType] ??
              entry.messageType.replaceAll("-", " "),
          )}\n`;
    const linkedEvidence = attachmentIds(entry.document)
      .map((id) => evidenceById.get(id))
      .filter((item): item is ThreadExportEvidence => Boolean(item));
    const evidenceMarkdown =
      linkedEvidence.length === 0
        ? ""
        : `\n**Authorised evidence:**\n${linkedEvidence
            .map(
              (item) =>
                `- [${escapeMarkdown(
                  safeText(item.fileName, 160),
                )}](/api/v1/evidence/${encodeURIComponent(item.id)}) (${escapeMarkdown(
                  safeText(item.mimeType, 120),
                )})`,
            )
            .join("\n")}\n`;
    return [
      `## ${heading}`,
      "",
      `**${entry.createdAt.toISOString()} · ${escapeMarkdown(actor)} (${actorType})**`,
      structured,
      quoteMarkdown(text),
      evidenceMarkdown,
    ]
      .filter((part) => part !== "")
      .join("\n");
  });
  return [
    `# ${escapeMarkdown(safeRoomName)} thread`,
    "",
    `- **Room:** #${escapeMarkdown(safeSlug)}`,
    `- **Thread:** ${escapeMarkdown(threadTitle)}`,
    `- **Started:** ${root.createdAt.toISOString()}`,
    "",
    ...blocks,
    "",
  ].join("\n");
}

function fileName(room: ThreadExportRoom, rootMessageId: string): string {
  const safeSlug =
    room.slug
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "room";
  return `${safeSlug}-thread-${rootMessageId.slice(0, 8)}.md`;
}

type Database = ReturnType<typeof database>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function replyPage(
  tx: Transaction,
  organisationId: string,
  roomId: string,
  rootMessageId: string,
  cursor: { createdAt: Date; id: string } | null,
): Promise<ThreadExportEntry[]> {
  const conditions = [
    eq(schema.messages.organisationId, organisationId),
    eq(schema.messages.roomId, roomId),
    eq(schema.messages.threadParentId, rootMessageId),
    isNull(schema.messages.deletedAt),
  ];
  if (cursor) {
    conditions.push(
      or(
        gt(schema.messages.createdAt, cursor.createdAt),
        and(
          eq(schema.messages.createdAt, cursor.createdAt),
          gt(schema.messages.id, cursor.id),
        ),
      )!,
    );
  }
  return tx
    .select({
      id: schema.messages.id,
      threadParentId: schema.messages.threadParentId,
      authorName: schema.actors.displayName,
      authorType: schema.actors.actorType,
      messageType: schema.messages.messageType,
      document: schema.messages.document,
      plainText: schema.messages.plainText,
      createdAt: schema.messages.createdAt,
      deletedAt: schema.messages.deletedAt,
    })
    .from(schema.messages)
    .innerJoin(
      schema.actors,
      and(
        eq(schema.actors.organisationId, organisationId),
        eq(schema.actors.id, schema.messages.authorActorId),
      ),
    )
    .where(and(...conditions))
    .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id))
    .limit(THREAD_EXPORT_PAGE_SIZE);
}

export async function exportThreadMarkdown(
  subject: AuthorisationSubject,
  roomId: string,
  rootMessageId: string,
  traceId: string,
): Promise<{ markdown: string; fileName: string; entryCount: number }> {
  requireCapability(subject, "rooms.read");
  await new RoomService().assertMember(subject, roomId);
  return database().transaction(
    async (tx) => {
      const [room] = await tx
        .select({
          id: schema.rooms.id,
          slug: schema.rooms.slug,
          displayName: schema.rooms.displayName,
          policies: schema.rooms.policies,
        })
        .from(schema.rooms)
        .where(
          and(
            eq(schema.rooms.organisationId, subject.organisationId),
            eq(schema.rooms.id, roomId),
          ),
        )
        .limit(1);
      if (!room) throw new ApiProblem(404, "Not found", "Room not found.");
      const policies =
        room.policies &&
        typeof room.policies === "object" &&
        !Array.isArray(room.policies)
          ? (room.policies as Record<string, unknown>)
          : {};
      if (
        !hasCapability(subject, "rooms.manage") &&
        policies.exportAllowed !== true
      ) {
        throw new ApiProblem(
          403,
          "Forbidden",
          "Thread export is disabled for this room.",
        );
      }

      const [root] = await tx
        .select({
          id: schema.messages.id,
          threadParentId: schema.messages.threadParentId,
          authorName: schema.actors.displayName,
          authorType: schema.actors.actorType,
          messageType: schema.messages.messageType,
          document: schema.messages.document,
          plainText: schema.messages.plainText,
          createdAt: schema.messages.createdAt,
          deletedAt: schema.messages.deletedAt,
        })
        .from(schema.messages)
        .innerJoin(
          schema.actors,
          and(
            eq(schema.actors.organisationId, subject.organisationId),
            eq(schema.actors.id, schema.messages.authorActorId),
          ),
        )
        .where(
          and(
            eq(schema.messages.organisationId, subject.organisationId),
            eq(schema.messages.roomId, roomId),
            eq(schema.messages.id, rootMessageId),
            isNull(schema.messages.threadParentId),
            isNull(schema.messages.deletedAt),
          ),
        )
        .limit(1);
      if (!root) {
        throw new ApiProblem(404, "Not found", "Thread root not found.");
      }

      const pages: ThreadExportEntry[][] = [];
      let cursor: { createdAt: Date; id: string } | null = null;
      while (true) {
        const page = await replyPage(
          tx,
          subject.organisationId,
          roomId,
          rootMessageId,
          cursor,
        );
        pages.push(page);
        if (page.length < THREAD_EXPORT_PAGE_SIZE) break;
        const last = page.at(-1)!;
        cursor = { createdAt: last.createdAt, id: last.id };
      }
      const entries = mergeThreadPages([[root], ...pages]);
      const attachmentIdSet = new Set(
        entries.flatMap((entry) => attachmentIds(entry.document)),
      );
      const evidence =
        hasCapability(subject, "evidence.read") && attachmentIdSet.size > 0
          ? await tx
              .select({
                id: schema.evidence.id,
                fileName: schema.evidence.fileName,
                mimeType: schema.evidence.mimeType,
              })
              .from(schema.evidence)
              .where(
                and(
                  eq(schema.evidence.organisationId, subject.organisationId),
                  eq(schema.evidence.relatedRoomId, roomId),
                  inArray(schema.evidence.id, [...attachmentIdSet]),
                  eq(schema.evidence.retentionState, "active"),
                  ne(schema.evidence.scanState, "failed"),
                  ne(schema.evidence.scanState, "uploading"),
                ),
              )
          : [];
      const markdown = renderThreadMarkdown(
        room,
        rootMessageId,
        entries,
        evidence,
      );
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "room.thread.exported",
        targetType: "message",
        targetId: rootMessageId,
        metadata: {
          roomId,
          format: "markdown",
          entryCount: entries.length,
          evidenceLinkCount: evidence.length,
        },
        traceId,
      });
      return {
        markdown,
        fileName: fileName(room, rootMessageId),
        entryCount: entries.length,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read write" },
  );
}
