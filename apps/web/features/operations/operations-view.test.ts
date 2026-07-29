import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Operations board", () => {
  it("defaults to board mode with drag-and-drop status updates", async () => {
    const source = await readFile(
      new URL("./operations-view.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('useState<"list" | "board">("board")');
    expect(source).toContain('setData("text/task-id"');
    expect(source).toContain("getData(\"text/task-id\")");
    expect(source).toContain("useUpdateTask");
    expect(source).toContain("mutateAsync");
    expect(source).toContain("No demo or fixture tasks");
  });
});
