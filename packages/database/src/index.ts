import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

let pool: Pool | undefined;

export function database() {
  pool ??= new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://muster:muster@localhost:5432/muster",
    max: Number(process.env.DATABASE_POOL_SIZE ?? 20),
    statement_timeout: 15_000,
    application_name: "muster",
  });
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
