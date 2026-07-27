import { describe, expect, it } from "vitest";
import { governedFeeds, ResearchWatchlistInputSchema } from "./alfie-research-domain.ts";

describe("Alfie watchlist governance", () => {
  it("defaults to CISA KEV and rejects a non-allowlisted feed", () => {
    const input = ResearchWatchlistInputSchema.parse({
      name: "Microsoft watch",
      roomId: "018f55d8-c4c7-7c3e-88ef-000000000100",
    });
    expect(governedFeeds(input)[0]?.name).toContain("CISA");
    expect(() =>
      governedFeeds(
        ResearchWatchlistInputSchema.parse({
          ...input,
          sources: [{ name: "Hostile", url: "https://evil.example/feed.json" }],
        }),
      ),
    ).toThrow("approved HTTPS origin");
  });
});
