import { createHash } from "node:crypto";
import { requireCapability, type AuthorisationSubject } from "@muster/authz";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { ApiProblem } from "./api-context";

const CisaKev = {
  name: "CISA Known Exploited Vulnerabilities",
  url: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
} as const;

const FeedSchema = z.object({
  name: z.string().trim().min(1).max(160),
  url: z.url().max(2_000),
});

export const ResearchWatchlistInputSchema = z.object({
  name: z.string().trim().min(3).max(160),
  roomId: z.uuid(),
  vendors: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  technologies: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  sources: z.array(FeedSchema).max(10).default([]),
  cadenceMinutes: z.number().int().min(15).max(10_080).default(240),
  enabled: z.boolean().default(true),
});

export type ResearchWatchlistInput = z.infer<
  typeof ResearchWatchlistInputSchema
>;

function allowedOrigins() {
  const testOrigins =
    process.env.MUSTER_RESEARCH_TEST_MODE === "true"
      ? [
          "http://127.0.0.1:4123",
          "http://localhost:4123",
          ...(process.env.MUSTER_RESEARCH_TEST_ORIGINS ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        ]
      : [];
  return new Set([
    "https://www.cisa.gov",
    ...testOrigins,
    ...(process.env.MUSTER_RESEARCH_ALLOWED_FEED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ]);
}

export function governedFeeds(input: ResearchWatchlistInput) {
  const feeds = input.sources.length ? input.sources : [CisaKev];
  const allowed = allowedOrigins();
  for (const feed of feeds) {
    const parsed = new URL(feed.url);
    if (
      (parsed.protocol !== "https:" &&
        process.env.MUSTER_RESEARCH_TEST_MODE !== "true") ||
      !allowed.has(parsed.origin)
    ) {
      throw new ApiProblem(
        400,
        "Source not allowlisted",
        "Research feeds must use an approved HTTPS origin.",
      );
    }
  }
  return feeds;
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class AlfieResearchDomainService {
  constructor(private readonly db = database()) {}

  async list(subject: AuthorisationSubject) {
    requireCapability(subject, "agents.read");
    return this.db
      .select()
      .from(schema.researchWatchlists)
      .where(
        and(
          eq(schema.researchWatchlists.organisationId, subject.organisationId),
          isNull(schema.researchWatchlists.archivedAt),
        ),
      );
  }

  async create(subject: AuthorisationSubject, raw: unknown, traceId: string) {
    requireCapability(subject, "agents.manage");
    const input = ResearchWatchlistInputSchema.parse(raw);
    const feeds = governedFeeds(input);
    return this.db.transaction(async (tx) => {
      const [room] = await tx
        .select({ id: schema.rooms.id })
        .from(schema.rooms)
        .where(
          and(
            eq(schema.rooms.organisationId, subject.organisationId),
            eq(schema.rooms.id, input.roomId),
          ),
        )
        .limit(1);
      if (!room)
        throw new ApiProblem(404, "Room not found", "Room does not exist.");
      const id = newId();
      const [created] = await tx
        .insert(schema.researchWatchlists)
        .values({
          id,
          organisationId: subject.organisationId,
          roomId: input.roomId,
          createdByActorId: subject.actorId,
          name: input.name,
          vendors: input.vendors,
          technologies: input.technologies,
          sources: feeds,
          cadenceMinutes: input.cadenceMinutes,
          enabled: input.enabled,
          nextRunAt: new Date(),
        })
        .onConflictDoNothing({
          target: [
            schema.researchWatchlists.organisationId,
            schema.researchWatchlists.name,
          ],
        })
        .returning();
      if (!created) {
        throw new ApiProblem(
          409,
          "Watchlist exists",
          "Watchlist name already exists.",
        );
      }
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "research.watchlist.created",
        targetType: "research_watchlist",
        targetId: id,
        metadata: {
          feeds: feeds.map((feed) => feed.url),
          cadenceMinutes: input.cadenceMinutes,
        },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "research.schedule.tick",
        aggregateType: "research_watchlist",
        aggregateId: id,
        queueName: "muster-maintenance",
        payload: { watchlistId: id },
        idempotencyKey: `research.schedule.tick:${id}:${Math.floor(Date.now() / 60_000)}`,
        traceId,
      });
      return created;
    });
  }

  async feedback(
    subject: AuthorisationSubject,
    itemId: string,
    feedback: "useful" | "irrelevant" | "duplicate",
    traceId: string,
  ) {
    requireCapability(subject, "agents.invoke");
    return this.db.transaction(async (tx) => {
      const [item] = await tx
        .update(schema.researchItems)
        .set({
          feedback,
          feedbackByActorId: subject.actorId,
          feedbackAt: new Date(),
        })
        .where(
          and(
            eq(schema.researchItems.organisationId, subject.organisationId),
            eq(schema.researchItems.id, itemId),
          ),
        )
        .returning();
      if (!item)
        throw new ApiProblem(
          404,
          "Brief not found",
          "Research brief does not exist.",
        );
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "research.brief.feedback",
        targetType: "research_item",
        targetId: itemId,
        metadata: { feedback, briefHash: hash(item.brief) },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "research.brief.feedback",
        aggregateType: "research_item",
        aggregateId: itemId,
        queueName: "muster-outbox",
        payload: { researchItemId: itemId, feedback },
        idempotencyKey: `research.brief.feedback:${itemId}:${traceId}`,
        traceId,
      });
      return item;
    });
  }
}
