import { z } from "zod";

export const ResearchFeedSchema = z.object({
  name: z.string().min(1).max(160),
  url: z.url().max(2_000),
});

export type ResearchFinding = {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string;
  publishedAt: Date | null;
  vendors: string[];
  technologies: string[];
  urgency: "critical" | "high" | "medium" | "low";
  confidence: number;
  caseIds: string[];
};

function plain(value: unknown, max = 2_000) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max).trim()
    : "";
}

function date(value: unknown) {
  const parsed = typeof value === "string" ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.valueOf()) ? parsed : null;
}

function strings(value: unknown, max = 50) {
  return Array.isArray(value)
    ? value.map((entry) => plain(entry, 160)).filter(Boolean).slice(0, max)
    : [];
}

export function parseResearchFeed(
  raw: unknown,
  source: { name: string; url: string },
): ResearchFinding[] {
  const document = z.record(z.string(), z.unknown()).parse(raw);
  const cisa = Array.isArray(document.vulnerabilities)
    ? document.vulnerabilities
    : [];
  const generic = Array.isArray(document.items) ? document.items : [];
  const entries = cisa.length ? cisa : generic;
  return entries.slice(0, 200).flatMap((entry, index) => {
    const item = z.record(z.string(), z.unknown()).safeParse(entry);
    if (!item.success) return [];
    const data = item.data;
    const id = plain(data.cveID ?? data.id ?? data.guid ?? `${source.url}:${index}`, 240);
    const title = plain(data.vulnerabilityName ?? data.title ?? id, 500);
    const summary = plain(data.shortDescription ?? data.summary ?? data.content_text, 4_000);
    if (!id || !title || !summary) return [];
    const ransomware = plain(data.knownRansomwareCampaignUse).toLowerCase() === "known";
    const urgency = ransomware
      ? "critical"
      : /critical|actively exploited|exploitation/i.test(`${title} ${summary}`)
        ? "high"
        : "medium";
    return [{
      id,
      title,
      summary,
      sourceUrl: plain(data.url ?? data.link ?? source.url, 2_000) || source.url,
      publishedAt: date(data.dateAdded ?? data.date_published ?? data.published),
      vendors: strings([data.vendorProject, ...strings(data.vendors)]),
      technologies: strings([data.product, ...strings(data.technologies)]),
      urgency,
      confidence: cisa.length ? 95 : 70,
      caseIds: strings(data.kelpieCaseIds ?? data.caseIds),
    }];
  });
}

export function matchesWatchlist(
  finding: ResearchFinding,
  vendors: string[],
  technologies: string[],
) {
  const target = `${finding.title} ${finding.summary} ${finding.vendors.join(" ")} ${finding.technologies.join(" ")}`.toLowerCase();
  const terms = [...vendors, ...technologies].map((value) => value.toLowerCase());
  return terms.length === 0 || terms.some((term) => target.includes(term));
}
