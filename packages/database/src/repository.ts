import { and, desc, eq, sql } from "drizzle-orm";
import type { database } from "./index.ts";
import {
  alerts,
  findings,
  investigations,
  messages,
  rooms,
} from "./schema.ts";

type Database = ReturnType<typeof database>;

export class TenantRepository {
  constructor(
    private readonly db: Database,
    readonly organisationId: string,
  ) {}

  room(id: string) {
    return this.db.query.rooms.findFirst({
      where: and(eq(rooms.organisationId, this.organisationId), eq(rooms.id, id)),
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

  async search(query: string, limit = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const [messageRows, alertRows, investigationRows, findingRows] =
      await Promise.all([
        this.db
          .select({
            id: messages.id,
            type: sql<string>`'message'`,
            title: messages.plainText,
            roomId: messages.roomId,
            rank: sql<number>`ts_rank(to_tsvector('english', ${messages.plainText}), websearch_to_tsquery('english', ${query}))`,
          })
          .from(messages)
          .where(
            and(
              eq(messages.organisationId, this.organisationId),
              sql`to_tsvector('english', ${messages.plainText}) @@ websearch_to_tsquery('english', ${query})`,
            ),
          )
          .limit(safeLimit),
        this.db
          .select({
            id: alerts.id,
            type: sql<string>`'alert'`,
            title: alerts.title,
            roomId: alerts.roomId,
            rank: sql<number>`ts_rank(to_tsvector('english', ${alerts.title} || ' ' || ${alerts.description}), websearch_to_tsquery('english', ${query}))`,
          })
          .from(alerts)
          .where(
            and(
              eq(alerts.organisationId, this.organisationId),
              sql`to_tsvector('english', ${alerts.title} || ' ' || ${alerts.description}) @@ websearch_to_tsquery('english', ${query})`,
            ),
          )
          .limit(safeLimit),
        this.db
          .select({
            id: investigations.id,
            type: sql<string>`'investigation'`,
            title: investigations.title,
            roomId: investigations.roomId,
            rank: sql<number>`ts_rank(to_tsvector('english', ${investigations.title} || ' ' || ${investigations.summary}), websearch_to_tsquery('english', ${query}))`,
          })
          .from(investigations)
          .where(
            and(
              eq(investigations.organisationId, this.organisationId),
              sql`to_tsvector('english', ${investigations.title} || ' ' || ${investigations.summary}) @@ websearch_to_tsquery('english', ${query})`,
            ),
          )
          .limit(safeLimit),
        this.db
          .select({
            id: findings.id,
            type: sql<string>`'finding'`,
            title: findings.title,
            roomId: sql<string | null>`null`,
            rank: sql<number>`ts_rank(to_tsvector('english', ${findings.title} || ' ' || ${findings.summary}), websearch_to_tsquery('english', ${query}))`,
          })
          .from(findings)
          .where(
            and(
              eq(findings.organisationId, this.organisationId),
              sql`to_tsvector('english', ${findings.title} || ' ' || ${findings.summary}) @@ websearch_to_tsquery('english', ${query})`,
            ),
          )
          .limit(safeLimit),
      ]);
    return [...messageRows, ...alertRows, ...investigationRows, ...findingRows]
      .sort((left, right) => right.rank - left.rank)
      .slice(0, safeLimit);
  }
}
