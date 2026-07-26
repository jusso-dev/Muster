import { describe, expect, it } from "vitest";
import {
  parseSearchQuery,
  removeSearchFilter,
  searchDateBoundary,
} from "./search-query";

describe("search query filters", () => {
  it("separates structured filters from full-text terms", () => {
    expect(
      parseSearchQuery(
        'powershell from:"Maya Chen" in:"SOC Operations" after:2026-07-01 before:2026-07-27',
      ),
    ).toMatchObject({
      text: "powershell",
      filters: {
        from: "Maya Chen",
        in: "SOC Operations",
        after: "2026-07-01",
        before: "2026-07-27",
      },
    });
  });

  it("supports filters without full-text terms", () => {
    expect(parseSearchQuery("from:jessie in:soc-operations")).toMatchObject({
      text: "",
      filters: { from: "jessie", in: "soc-operations" },
    });
  });

  it("keeps invalid and duplicate filters as ordinary search text", () => {
    expect(
      parseSearchQuery(
        "from:Maya from:Jessie after:yesterday before:2026-02-30 beacon",
      ),
    ).toMatchObject({
      text: "from:Jessie after:yesterday before:2026-02-30 beacon",
      filters: { from: "Maya" },
    });
  });

  it("does not parse incomplete quotes or unknown operators", () => {
    expect(parseSearchQuery('has:link from:"Maya Chen')).toEqual({
      text: 'has:link from:"Maya Chen',
      filters: {},
      tokens: [],
    });
  });

  it("removes one parsed filter without changing ordinary text", () => {
    expect(
      removeSearchFilter(
        'beacon from:"Maya Chen" after:yesterday in:soc',
        "from",
      ),
    ).toBe("beacon after:yesterday in:soc");
  });

  it("uses deterministic UTC day boundaries", () => {
    expect(searchDateBoundary("2026-07-26").toISOString()).toBe(
      "2026-07-26T00:00:00.000Z",
    );
    expect(() => searchDateBoundary("2026-07-32")).toThrow("Invalid ISO date");
  });
});
