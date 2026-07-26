import { describe, expect, it } from "vitest";
import { extractObservables } from "./jessie-hunt-domain";

describe("Jessie observable normalization", () => {
  it("normalizes supported IoCs deterministically without inventing values", () => {
    expect(
      extractObservables(
        "Check 192.0.2.4, Example.COM., https://EXAMPLE.com/a and 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef for analyst@example.com",
      ),
    ).toEqual([
      { type: "ip", value: "192.0.2.4", normalizedValue: "192.0.2.4" },
      {
        type: "hash",
        value:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        normalizedValue:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      },
      {
        type: "url",
        value: "https://EXAMPLE.com/a",
        normalizedValue: "https://example.com/a",
      },
      {
        type: "domain",
        value: "Example.COM",
        normalizedValue: "example.com",
      },
      {
        type: "identity",
        value: "analyst@example.com",
        normalizedValue: "analyst@example.com",
      },
    ]);
  });

  it("rejects invalid IP-shaped text and deduplicates normalized values", () => {
    expect(
      extractObservables("999.999.999.999 EXAMPLE.com example.com"),
    ).toEqual([
      {
        type: "domain",
        value: "EXAMPLE.com",
        normalizedValue: "example.com",
      },
    ]);
  });
});
