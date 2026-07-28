import { sql } from "drizzle-orm";
import type { database } from "@muster/database";

/**
 * A real dependency-aware readiness check, not a static liveness stub: a
 * Postgres outage must surface as a non-ready response, not a false-positive
 * "ready" that orchestrators route traffic to anyway.
 */
export async function checkDatabaseHealth(
  db: ReturnType<typeof database>,
): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
