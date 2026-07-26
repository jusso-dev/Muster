export const searchFilterNames = ["from", "in", "after", "before"] as const;

export type SearchFilterName = (typeof searchFilterNames)[number];

export interface ParsedSearchToken {
  name: SearchFilterName;
  value: string;
  raw: string;
  start: number;
  end: number;
}

export interface ParsedSearchQuery {
  text: string;
  filters: Partial<Record<SearchFilterName, string>>;
  tokens: ParsedSearchToken[];
}

const tokenPattern =
  /(?:^|\s)(from|in|after|before):(?:"([^"]+)"|([^\s"]+))/giu;
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

function isIsoDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

export function parseSearchQuery(input: string): ParsedSearchQuery {
  const filters: Partial<Record<SearchFilterName, string>> = {};
  const tokens: ParsedSearchToken[] = [];

  for (const match of input.matchAll(tokenPattern)) {
    const name = match[1]?.toLowerCase() as SearchFilterName;
    const value = (match[2] ?? match[3] ?? "").trim();
    if (
      !value ||
      filters[name] !== undefined ||
      ((name === "after" || name === "before") && !isIsoDate(value))
    ) {
      continue;
    }

    const leadingWhitespace = match[0].length - match[0].trimStart().length;
    const start = (match.index ?? 0) + leadingWhitespace;
    const raw = match[0].trimStart();
    filters[name] = value;
    tokens.push({ name, value, raw, start, end: start + raw.length });
  }

  let text = input;
  for (const token of [...tokens].sort(
    (left, right) => right.start - left.start,
  )) {
    text = `${text.slice(0, token.start)}${text.slice(token.end)}`;
  }

  return {
    text: text.replace(/\s+/gu, " ").trim(),
    filters,
    tokens,
  };
}

export function removeSearchFilter(
  input: string,
  name: SearchFilterName,
): string {
  const token = parseSearchQuery(input).tokens.find(
    (candidate) => candidate.name === name,
  );
  if (!token) return input.trim();
  return `${input.slice(0, token.start)}${input.slice(token.end)}`
    .replace(/\s+/gu, " ")
    .trim();
}

export function searchDateBoundary(value: string): Date {
  if (!isIsoDate(value)) throw new Error(`Invalid ISO date: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
}
