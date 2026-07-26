import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, database } from "./index.ts";

const here = dirname(fileURLToPath(import.meta.url));
await migrate(database(), { migrationsFolder: resolve(here, "../migrations") });
await closeDatabase();
