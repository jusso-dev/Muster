import { sql } from "drizzle-orm";
import { database } from "@muster/database";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await database().execute(sql`select 1`);
    return Response.json({
      status: "healthy",
      product: "Muster",
      version: process.env.npm_package_version ?? "0.1.0",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return Response.json({ status: "unhealthy" }, { status: 503 });
  }
}
