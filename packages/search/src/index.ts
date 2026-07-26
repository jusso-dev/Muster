import { z } from "zod";
import { TenantRepository, database } from "@muster/database";

export const SearchRequestSchema = z
  .object({
    organisationId: z.string().uuid(),
    actorId: z.string().uuid(),
    query: z.string().trim().max(500).default(""),
    filters: z
      .object({
        fromActorId: z.string().uuid().optional(),
        roomId: z.string().uuid().optional(),
        after: z.coerce.date().optional(),
        before: z.coerce.date().optional(),
      })
      .default({}),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .refine(
    (request) =>
      request.query.length > 0 || Object.keys(request.filters).length > 0,
    { message: "A search query or structured filter is required." },
  );

export function searchOrganisation(input: unknown) {
  const request = SearchRequestSchema.parse(input);
  const filters = {
    ...(request.filters.fromActorId
      ? { fromActorId: request.filters.fromActorId }
      : {}),
    ...(request.filters.roomId ? { roomId: request.filters.roomId } : {}),
    ...(request.filters.after ? { after: request.filters.after } : {}),
    ...(request.filters.before ? { before: request.filters.before } : {}),
  };
  return new TenantRepository(database(), request.organisationId).search(
    request.query,
    request.actorId,
    filters,
    request.limit,
  );
}
