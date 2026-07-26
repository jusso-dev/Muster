import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import {
  MsepEnvelopeSchema,
  type MsepEnvelope,
} from "@muster/contracts";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

export function unsignedPayload(event: MsepEnvelope) {
  const { integrity, ...payload } = event;
  return payload;
}

export function signMsep(
  event: Omit<MsepEnvelope, "integrity">,
  key: string,
  issuer: string,
  keyId: string,
): MsepEnvelope {
  const signature = createHmac("sha256", key)
    .update(canonical(event))
    .digest("base64url");
  return MsepEnvelopeSchema.parse({
    ...event,
    integrity: {
      issuer,
      algorithm: "hmac-sha256",
      keyId,
      signature,
    },
  });
}

export function verifyMsep(event: unknown, key: string): MsepEnvelope {
  const parsed = MsepEnvelopeSchema.parse(event);
  const expected = createHmac("sha256", key)
    .update(canonical(unsignedPayload(parsed)))
    .digest();
  const supplied = Buffer.from(parsed.integrity.signature, "base64url");
  if (
    expected.byteLength !== supplied.byteLength ||
    !timingSafeEqual(expected, supplied)
  ) {
    throw new Error("MSEP signature validation failed");
  }
  return parsed;
}

export class ReplayWindow {
  private readonly seen = new Map<string, number>();
  constructor(private readonly ttlMs = 10 * 60_000) {}

  assertFresh(event: MsepEnvelope, now = Date.now()): void {
    for (const [id, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(id);
    }
    if (this.seen.has(event.id)) throw new Error("MSEP replay detected");
    const received = Date.parse(event.receivedAt);
    if (Math.abs(now - received) > this.ttlMs) {
      throw new Error("MSEP event outside replay window");
    }
    this.seen.set(event.id, now + this.ttlMs);
  }
}
