import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const tokens = new URL("../../../tokens.css", import.meta.url);

/**
 * The scale used to sit a step below browser defaults, and `text-xs` carried
 * most body copy, so the product read as small grey print.
 */
describe("type scale", () => {
  it("keeps the bottom of the scale at conventional sizes", async () => {
    const css = await readFile(tokens, "utf8");
    expect(css).toContain("--text-xs: 0.75rem;");
    expect(css).toContain("--text-sm: 0.875rem;");
    expect(css).toContain("--text-base: 1rem;");
  });

  it("keeps secondary copy clear of the contrast floor", async () => {
    const css = await readFile(tokens, "utf8");
    const dark = css.match(/--color-muted: oklch\(([0-9.]+)/);
    expect(dark).not.toBeNull();
    expect(Number(dark![1])).toBeGreaterThanOrEqual(0.72);
  });
});

describe("shared surfaces read at body size", () => {
  it("uses body size for page descriptions, empty states, and errors", async () => {
    const header = await readFile(
      new URL("./page-header.tsx", import.meta.url),
      "utf8",
    );
    expect(header).toContain(
      '<p className="mt-1 text-sm text-muted-foreground">{description}</p>',
    );

    const empty = await readFile(
      new URL("./os/empty-state.tsx", import.meta.url),
      "utf8",
    );
    expect(empty).toContain('max-w-md text-sm text-muted-foreground');

    const error = await readFile(
      new URL("./os/error-state.tsx", import.meta.url),
      "utf8",
    );
    expect(error).toContain('text-sm text-foreground/90');
  });
});
