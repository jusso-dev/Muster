import { describe, expect, it } from "vitest";
import {
  mergeThreadPages,
  renderThreadMarkdown,
  type ThreadExportEntry,
} from "./thread-export-domain";

const rootId = "019c9e27-3ee7-7b91-a7d8-4a68d1741000";
const room = {
  id: "room-synthetic",
  slug: "synthetic-review",
  displayName: "Synthetic *review*",
};

function entry(
  id: string,
  values: Partial<ThreadExportEntry> = {},
): ThreadExportEntry {
  return {
    id,
    threadParentId: id === rootId ? null : rootId,
    authorName: "Synthetic Analyst",
    authorType: "human",
    messageType: "text",
    document: { type: "doc", content: [] },
    plainText: `Synthetic message ${id.slice(-4)}`,
    createdAt: new Date("2026-07-26T22:00:00.000Z"),
    deletedAt: null,
    ...values,
  };
}

describe("thread Markdown export", () => {
  it("orders root and replies deterministically and de-duplicates page boundaries", () => {
    const replyA = entry("019c9e27-3ee7-7b91-a7d8-4a68d1741001");
    const replyB = entry("019c9e27-3ee7-7b91-a7d8-4a68d1741002");
    const deleted = entry("019c9e27-3ee7-7b91-a7d8-4a68d1741003", {
      deletedAt: new Date("2026-07-26T22:01:00.000Z"),
    });

    expect(
      mergeThreadPages([
        [replyB, deleted],
        [replyA, replyB],
        [entry(rootId)],
      ]).map(({ id }) => id),
    ).toEqual([rootId, replyA.id, replyB.id]);
  });

  it("always renders the root before same-time replies", () => {
    const replyWithEarlierId = entry("019c9e27-3ee7-7b91-a7d8-4a68d1740001", {
      plainText: "Same-time reply",
    });
    const markdown = renderThreadMarkdown(
      room,
      rootId,
      [replyWithEarlierId, entry(rootId, { plainText: "Thread root" })],
      [],
    );

    expect(markdown.indexOf("> Thread root")).toBeLessThan(
      markdown.indexOf("> Same\\-time reply"),
    );
  });

  it("escapes Markdown metacharacters in room, actor, and message text", () => {
    const markdown = renderThreadMarkdown(
      room,
      rootId,
      [
        entry(rootId, {
          authorName: "Analyst [One]",
          plainText: "# heading\n[unsafe](https://outside.invalid) *bold*",
        }),
      ],
      [],
    );

    expect(markdown).toContain("# Synthetic \\*review\\* thread");
    expect(markdown).toContain("Analyst \\[One\\]");
    expect(markdown).toContain(
      "> \\# heading\n> \\[unsafe\\]\\(https://outside\\.invalid\\) \\*bold\\*",
    );
    expect(markdown).not.toContain("[unsafe](https://outside.invalid)");
  });

  it("redacts secret-shaped text and removes dangerous control characters", () => {
    const canary = "synthetic-thread-secret";
    const markdown = renderThreadMarkdown(
      room,
      rootId,
      [
        entry(rootId, {
          plainText: `Authorization: Bearer ${canary}\u202e`,
        }),
      ],
      [],
    );

    expect(markdown).toContain("\\[REDACTED\\]");
    expect(markdown).not.toContain(canary);
    expect(markdown).not.toContain("\u202e");
  });

  it("renders mixed human, agent, and structured entries with authorised evidence only", () => {
    const evidenceId = "019c9e27-3ee7-7b91-a7d8-4a68d1741e01";
    const hiddenEvidenceId = "019c9e27-3ee7-7b91-a7d8-4a68d1741e02";
    const entries = [
      entry(rootId, { plainText: "Review synthetic endpoint activity." }),
      entry("019c9e27-3ee7-7b91-a7d8-4a68d1741001", {
        authorName: "Synthetic Triage Agent",
        authorType: "agent",
        plainText: "No malicious activity found.",
      }),
      entry("019c9e27-3ee7-7b91-a7d8-4a68d1741002", {
        authorName: "Muster",
        authorType: "system",
        messageType: "finding",
        document: {
          type: "doc",
          content: [
            { type: "attachment", attrs: { id: evidenceId } },
            { type: "attachment", attrs: { id: hiddenEvidenceId } },
          ],
        },
        plainText: "Synthetic finding verified.",
      }),
    ];
    const markdown = renderThreadMarkdown(room, rootId, entries, [
      {
        id: evidenceId,
        fileName: "synthetic [finding].json",
        mimeType: "application/json",
      },
    ]);

    expect(markdown).toContain("Synthetic Analyst (Human)");
    expect(markdown).toContain("Synthetic Triage Agent (Agent)");
    expect(markdown).toContain("Muster (System)");
    expect(markdown).toContain("**Entry type:** Investigation finding");
    expect(markdown).toContain(`/api/v1/evidence/${evidenceId}`);
    expect(markdown).not.toContain(hiddenEvidenceId);
  });

  it("keeps long paginated threads complete, unique, and byte-stable", () => {
    const replies = Array.from({ length: 205 }, (_, index) =>
      entry(`019c9e27-3ee7-7b91-a7d8-${String(index + 1).padStart(12, "0")}`, {
        createdAt: new Date(
          Date.parse("2026-07-26T22:00:00.000Z") + index * 1_000,
        ),
      }),
    );
    const merged = mergeThreadPages([
      [entry(rootId), ...replies.slice(0, 100)],
      [replies[99]!, ...replies.slice(100, 200)],
      [replies[199]!, ...replies.slice(200)],
    ]);
    const first = renderThreadMarkdown(room, rootId, merged, []);
    const second = renderThreadMarkdown(room, rootId, merged, []);

    expect(merged).toHaveLength(206);
    expect(new Set(merged.map(({ id }) => id)).size).toBe(206);
    expect(first).toBe(second);
    expect(first.match(/^## Reply /gm)).toHaveLength(205);
  });
});
