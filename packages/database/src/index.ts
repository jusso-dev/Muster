import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

let pool: Pool | undefined;

export function database() {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        "postgresql://muster:muster@localhost:5432/muster",
      max: Number(process.env.DATABASE_POOL_SIZE ?? 20),
      statement_timeout: 15_000,
      application_name: "muster",
    });
    // node-postgres requires an error listener on the pool: an idle client
    // error (a database restart, a network blip) is otherwise an unhandled
    // 'error' event, which crashes the entire process rather than letting a
    // health check or the next query simply fail.
    pool.on("error", (error) => {
      console.error("pg.pool.error", error.message);
    });
  }
  return drizzle(pool, { schema });
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export { schema };
export * from "./ids.ts";
export * from "./domain-transaction.ts";
export * from "./outbox.ts";
export * from "./repository.ts";
export * from "./synthetic-cleanup.ts";
