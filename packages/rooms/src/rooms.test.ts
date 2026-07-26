import { describe, expect, it } from "vitest";
import { PostMessageSchema, sanitiseMessageDocument } from "./index.ts";

describe("message document policy", () => {
  it("keeps supported formatting and safe links", () => {
    expect(
      sanitiseMessageDocument({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Synthetic reference",
                marks: [
                  { type: "bold" },
                  {
                    type: "link",
                    attrs: { href: "https://example.invalid/evidence/17" },
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Synthetic reference",
              marks: [
                { type: "bold" },
                {
                  type: "link",
                  attrs: { href: "https://example.invalid/evidence/17" },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("rejects executable links and untrusted HTML nodes", () => {
    expect(() =>
      sanitiseMessageDocument({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "unsafe",
                marks: [
                  { type: "link", attrs: { href: "javascript:alert(1)" } },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow("Unsafe message link");
    expect(() =>
      sanitiseMessageDocument({
        type: "doc",
        content: [{ type: "html", html: "<img onerror=alert(1)>" }],
      }),
    ).toThrow("Unsupported message document node");
  });

  it("normalises plain text and requires durable idempotency", () => {
    const parsed = PostMessageSchema.parse({
      roomId: "018f55d8-c4c7-7c3e-88ef-000000000107",
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Synthetic message" }],
          },
        ],
      },
      plainText: "  Synthetic message  ",
      dataClassification: "internal",
      idempotencyKey: "synthetic-message-17",
    });
    expect(parsed.plainText).toBe("Synthetic message");
    expect(parsed.messageType).toBe("text");
  });
});
