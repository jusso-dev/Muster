import { z } from "zod";
import { TenantRepository, database } from "@muster/database";

export const SearchRequestSchema = z.object({
  organisationId: z.string().uuid(),
  actorId: z.string().uuid(),
  query: z.string().trim().min(2).max(500),
  limit: z.number().int().min(1).max(100).default(20),
});

export function searchOrganisation(input: unknown) {
  const request = SearchRequestSchema.parse(input);
  return new TenantRepository(database(), request.organisationId).search(
    request.query,
    request.actorId,
    request.limit,
  );
}
