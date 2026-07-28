import { describe, expect, it } from "vitest";
import { gracefulShutdown } from "./shutdown.ts";

describe("gracefulShutdown", () => {
  it("closes the database only after the server finishes draining", async () => {
    const events: string[] = [];
    const server = {
      close: (callback: (error?: Error) => void) => {
        setTimeout(() => {
          events.push("server.closed");
          callback();
        }, 10);
      },
    };
    const closeDb = async () => {
      events.push("db.closed");
    };
    await gracefulShutdown(server, closeDb);
    expect(events).toEqual(["server.closed", "db.closed"]);
  });

  it("propagates a server close error instead of closing the database", async () => {
    const server = {
      close: (callback: (error?: Error) => void) => {
        callback(new Error("close failed"));
      },
    };
    let dbClosed = false;
    const closeDb = async () => {
      dbClosed = true;
    };
    await expect(gracefulShutdown(server, closeDb)).rejects.toThrow(
      "close failed",
    );
    expect(dbClosed).toBe(false);
  });
});
