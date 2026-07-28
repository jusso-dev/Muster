import { describe, expect, it } from "vitest";
import { checkDatabaseHealth } from "./health.ts";

describe("checkDatabaseHealth", () => {
  it("is ready when the database responds", async () => {
    const db = { execute: async () => undefined } as never;
    expect(await checkDatabaseHealth(db)).toBe(true);
  });

  it("is not ready when the database is unreachable", async () => {
    const db = {
      execute: async () => {
        throw new Error("connection refused");
      },
    } as never;
    expect(await checkDatabaseHealth(db)).toBe(false);
  });
});
