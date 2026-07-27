export function researchRunIdempotencyKey(
  watchlistId: string,
  cadenceMinutes: number,
  now = new Date(),
) {
  return `research:${watchlistId}:${Math.floor(now.valueOf() / (cadenceMinutes * 60_000))}`;
}

export function finalResearchAttempt(attemptsMade: number, attempts: number) {
  return attemptsMade + 1 >= attempts;
}

export function staleResearchEvidence(
  publishedAt: Date | null,
  now = new Date(),
) {
  return Boolean(
    publishedAt && now.valueOf() - publishedAt.valueOf() > 90 * 86_400_000,
  );
}
