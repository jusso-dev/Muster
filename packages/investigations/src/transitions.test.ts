import { describe, expect, it } from "vitest";
import { assertInvestigationTransition } from "./index";

describe("investigation transitions", () => {
  it("blocks direct open-to-promoted transition", () => {
    expect(() => assertInvestigationTransition("open", "promoted")).toThrow(
      "Invalid investigation transition",
    );
  });
});
