import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function isGatewayRequestAuthorised(
  authorization: string | undefined,
  expectedToken: string,
) {
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

export function parseGatewayOrganisationId(
  value: string | string[] | undefined,
) {
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}
