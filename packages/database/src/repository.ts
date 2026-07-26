import {
  and,
  desc,
  eq,
  gte,
  isNull,
  lt,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import type { database } from "./index.ts";
import {
  actors,
  alerts,
  findings,
  investigations,
  messages,
  roomMemberships,
  rooms,
} from "./schema.ts";

type Database = ReturnType<typeof database>;

export interface SearchFilters {
  fromActorId?: string;
  roomId?: string;
  after?: Date;
  before?: Date;
}

export interface SearchFilterInput {
  from?: string;
  in?: string;
  after?: Date;
  before?: Date;
}

export interface ResolvedSearchFilters {
  filters: SearchFilters;
  labels: {
    from?: string;
    in?: string;
  };
}

export class SearchFilterResolutionError extends Error {
  constructor(
    readonly filter: "from" | "in",
    readonly value: string,
    readonly reason: "unknown" | "ambiguous",
  ) {
    super(
      `${reason === "unknown" ? "Unknown" : "Ambiguous"} ${filter}: search filter "${value}".`,
    );
  }
}

export class TenantRepository {
  constructor(
    private readonly db: Database,
    readonly organisationId: string,
  ) {}

  room(id: string) {
    return this.db.query.rooms.findFirst({
      where: and(
        eq(rooms.organisationId, this.organisationId),
        eq(rooms.id, id),
      ),
    });
  }

  rooms() {
    return this.db
      .select()
      .from(rooms)
      .where(eq(rooms.organisationId, this.organisationId))
      .orderBy(rooms.displayName);
  }

  messages(roomId: string, limit = 100) {
    return this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.organisationId, this.organisationId),
          eq(messages.roomId, roomId),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(Math.min(limit, 200));
  }

  alert(id: string) {
    return this.db.query.alerts.findFirst({
      where: and(
        eq(alerts.organisationId, this.organisationId),
        eq(alerts.id, id),
      ),
    });
  }

  investigation(id: string) {
    return this.db.query.investigations.findFirst({
      where: and(
        eq(investigations.organisationId, this.organisationId),
        eq(investigations.id, id),
      ),
    });
  }

  async resolveSearchFilters(
    actorId: string,
    input: SearchFilterInput,
  ): Promise<ResolvedSearchFilters> {
    const resolved: ResolvedSearchFilters = {
      filters: {
        ...(input.after ? { after: input.after } : {}),
        ...(input.before ? { before: input.before } : {}),
      },
      labels: {},
    };

    if (input.from) {
      const actorRows = await this.db
        .select({ id: actors.id, label: actors.displayName })
        .from(actors)
        .where(
          and(
            eq(actors.organisationId, this.organisationId),
            or(
              sql`lower(${actors.displayName}) = lower(${input.from})`,
              sql`lower(coalesce(${actors.identityReference}, '')) = lower(${input.from})`,
            ),
            sql`(
              ${actors.id} = ${actorId}
              or exists (
                select 1
                from ${roomMemberships} candidate_membership
                join ${roomMemberships} requester_membership
                  on requester_membership.organisation_id = candidate_membership.organisation_id
                 and requester_membership.room_id = candidate_membership.room_id
                 and requester_membership.actor_id = ${actorId}
                 and (
                   requester_membership.access_expires_at is null
                   or requester_membership.access_expires_at > now()
                 )
                where candidate_membership.organisation_id = ${this.organisationId}
                  and candidate_membership.actor_id = ${actors.id}
                  and (
                    candidate_membership.access_expires_at is null
                    or candidate_membership.access_expires_at > now()
                  )
              )
            )`,
          ),
        )
        .limit(2);
      if (actorRows.length !== 1) {
        throw new SearchFilterResolutionError(
          "from",
          input.from,
          actorRows.length === 0 ? "unknown" : "ambiguous",
        );
      }
      resolved.filters.fromActorId = actorRows[0]!.id;
      resolved.labels.from = actorRows[0]!.label;
    }

    if (input.in) {
      const roomRows = await this.db
        .select({ id: rooms.id, label: rooms.displayName })
        .from(rooms)
        .innerJoin(
          roomMemberships,
          and(
            eq(roomMemberships.organisationId, rooms.organisationId),
            eq(roomMemberships.roomId, rooms.id),
            eq(roomMemberships.actorId, actorId),
            or(
              isNull(roomMemberships.accessExpiresAt),
              gte(roomMemberships.accessExpiresAt, new Date()),
            ),
          ),
        )
        .where(
          and(
            eq(rooms.organisationId, this.organisationId),
            or(
              sql`lower(${rooms.slug}) = lower(${input.in})`,
              sql`lower(${rooms.name}) = lower(${input.in})`,
              sql`lower(${rooms.displayName}) = lower(${input.in})`,
            ),
          ),
        )
        .limit(2);
      if (roomRows.length !== 1) {
        throw new SearchFilterResolutionError(
          "in",
          input.in,
          roomRows.length === 0 ? "unknown" : "ambiguous",
        );
      }
      resolved.filters.roomId = roomRows[0]!.id;
      resolved.labels.in = roomRows[0]!.label;
    }

    return resolved;
  }

  async search(
    query: string,
    actorId: string,
    filters: SearchFilters = {},
    limit = 20,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const fullText = query.trim();
    const visibleRoom = (roomId: SQLWrapper) =>
      sql`exists (
        select 1
        from ${roomMemberships} visible_membership
        where visible_membership.organisation_id = ${this.organisationId}
          and visible_membership.room_id = ${roomId}
          and visible_membership.actor_id = ${actorId}
          and (
            visible_membership.access_expires_at is null
            or visible_membership.access_expires_at > now()
          )
      )`;
    const textRank = (content: SQL) =>
      fullText
        ? sql<number>`ts_rank(to_tsvector('english', ${content}), websearch_to_tsquery('english', ${fullText}))`
        : sql<number>`cast(0 as real)`;
    const textMatch = (content: SQL) =>
      fullText
        ? sql`to_tsvector('english', ${content}) @@ websearch_to_tsquery('english', ${fullText})`
        : undefined;

    const messageContent = sql`${messages.plainText}`;
    const messageConditions: (SQL | undefined)[] = [
      eq(messages.organisationId, this.organisationId),
      isNull(messages.deletedAt),
      visibleRoom(messages.roomId),
      textMatch(messageContent),
      filters.fromActorId
        ? eq(messages.authorActorId, filters.fromActorId)
        : undefined,
      filters.roomId ? eq(messages.roomId, filters.roomId) : undefined,
      filters.after ? gte(messages.createdAt, filters.after) : undefined,
      filters.before ? lt(messages.createdAt, filters.before) : undefined,
    ];

    const alertContent = sql`${alerts.title} || ' ' || ${alerts.description}`;
    const alertConditions: (SQL | undefined)[] = [
      eq(alerts.organisationId, this.organisationId),
      visibleRoom(alerts.roomId),
      textMatch(alertContent),
      filters.roomId ? eq(alerts.roomId, filters.roomId) : undefined,
      filters.after ? gte(alerts.receivedAt, filters.after) : undefined,
      filters.before ? lt(alerts.receivedAt, filters.before) : undefined,
    ];

    const investigationContent = sql`${investigations.title} || ' ' || ${investigations.summary}`;
    const investigationConditions: (SQL | undefined)[] = [
      eq(investigations.organisationId, this.organisationId),
      visibleRoom(investigations.roomId),
      textMatch(investigationContent),
      filters.roomId ? eq(investigations.roomId, filters.roomId) : undefined,
      filters.after ? gte(investigations.createdAt, filters.after) : undefined,
      filters.before ? lt(investigations.createdAt, filters.before) : undefined,
    ];

    const findingContent = sql`${findings.title} || ' ' || ${findings.summary}`;
    const findingConditions: (SQL | undefined)[] = [
      eq(findings.organisationId, this.organisationId),
      eq(investigations.organisationId, this.organisationId),
      visibleRoom(investigations.roomId),
      textMatch(findingContent),
      filters.fromActorId
        ? eq(findings.createdByActorId, filters.fromActorId)
        : undefined,
      filters.roomId ? eq(investigations.roomId, filters.roomId) : undefined,
      filters.after ? gte(findings.createdAt, filters.after) : undefined,
      filters.before ? lt(findings.createdAt, filters.before) : undefined,
    ];

    const [messageRows, alertRows, investigationRows, findingRows] =
      await Promise.all([
        this.db
          .select({
            id: messages.id,
            type: sql<string>`'message'`,
            title: messages.plainText,
            roomId: messages.roomId,
            roomName: rooms.displayName,
            roomSlug: rooms.slug,
            actorName: actors.displayName,
            createdAt: messages.createdAt,
            rank: textRank(messageContent),
          })
          .from(messages)
          .innerJoin(
            rooms,
            and(
              eq(rooms.organisationId, messages.organisationId),
              eq(rooms.id, messages.roomId),
            ),
          )
          .innerJoin(
            actors,
            and(
              eq(actors.organisationId, messages.organisationId),
              eq(actors.id, messages.authorActorId),
            ),
          )
          .where(and(...messageConditions))
          .orderBy(desc(textRank(messageContent)), desc(messages.createdAt))
          .limit(safeLimit),
        filters.fromActorId
          ? Promise.resolve([])
          : this.db
              .select({
                id: alerts.id,
                type: sql<string>`'alert'`,
                title: alerts.title,
                roomId: alerts.roomId,
                roomName: rooms.displayName,
                roomSlug: rooms.slug,
                actorName: sql<string | null>`null`,
                createdAt: alerts.receivedAt,
                rank: textRank(alertContent),
              })
              .from(alerts)
              .innerJoin(
                rooms,
                and(
                  eq(rooms.organisationId, alerts.organisationId),
                  eq(rooms.id, alerts.roomId),
                ),
              )
              .where(and(...alertConditions))
              .orderBy(desc(textRank(alertContent)), desc(alerts.receivedAt))
              .limit(safeLimit),
        filters.fromActorId
          ? Promise.resolve([])
          : this.db
              .select({
                id: investigations.id,
                type: sql<string>`'investigation'`,
                title: investigations.title,
                roomId: investigations.roomId,
                roomName: rooms.displayName,
                roomSlug: rooms.slug,
                actorName: sql<string | null>`null`,
                createdAt: investigations.createdAt,
                rank: textRank(investigationContent),
              })
              .from(investigations)
              .innerJoin(
                rooms,
                and(
                  eq(rooms.organisationId, investigations.organisationId),
                  eq(rooms.id, investigations.roomId),
                ),
              )
              .where(and(...investigationConditions))
              .orderBy(
                desc(textRank(investigationContent)),
                desc(investigations.createdAt),
              )
              .limit(safeLimit),
        this.db
          .select({
            id: findings.id,
            type: sql<string>`'finding'`,
            title: findings.title,
            roomId: investigations.roomId,
            roomName: rooms.displayName,
            roomSlug: rooms.slug,
            actorName: actors.displayName,
            createdAt: findings.createdAt,
            rank: textRank(findingContent),
          })
          .from(findings)
          .innerJoin(
            investigations,
            and(
              eq(investigations.organisationId, findings.organisationId),
              eq(investigations.id, findings.investigationId),
            ),
          )
          .innerJoin(
            rooms,
            and(
              eq(rooms.organisationId, investigations.organisationId),
              eq(rooms.id, investigations.roomId),
            ),
          )
          .innerJoin(
            actors,
            and(
              eq(actors.organisationId, findings.organisationId),
              eq(actors.id, findings.createdByActorId),
            ),
          )
          .where(and(...findingConditions))
          .orderBy(desc(textRank(findingContent)), desc(findings.createdAt))
          .limit(safeLimit),
      ]);
    return [...messageRows, ...alertRows, ...investigationRows, ...findingRows]
      .sort(
        (left, right) =>
          right.rank - left.rank ||
          right.createdAt.valueOf() - left.createdAt.valueOf() ||
          right.id.localeCompare(left.id),
      )
      .slice(0, safeLimit);
  }
}
