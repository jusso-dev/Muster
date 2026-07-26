import { describe, expect, it, vi } from "vitest";
import { browserUuid } from "./browser-uuid";

describe("browserUuid", () => {
  it("uses randomUUID when the page is a secure context", () => {
    const randomUUID = vi.fn(
      () => "018f55d8-c4c7-7c3e-88ef-000000000001" as `${string}-${string}-${string}-${string}-${string}`,
    );
    const getRandomValues = vi.fn();

    expect(browserUuid({ randomUUID, getRandomValues })).toBe(
      "018f55d8-c4c7-7c3e-88ef-000000000001",
    );
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it("generates a version 4 UUID when randomUUID is unavailable on LAN HTTP", () => {
    const getRandomValues = vi.fn(<T extends ArrayBufferView | null>(value: T) => {
      if (!(value instanceof Uint8Array)) {
        throw new Error("Expected Uint8Array");
      }
      value.set([
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0xff, 0x99, 0xaa,
        0xbb, 0xcc, 0xdd, 0xee, 0xff,
      ]);
      return value;
    });

    expect(browserUuid({ getRandomValues })).toBe(
      "00112233-4455-4677-bf99-aabbccddeeff",
    );
  });
});
