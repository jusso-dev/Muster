export type OpsEnv = {
  tawnyBaseUrl: string | null;
  tawnyToken: string | null;
  kelpieBaseUrl: string | null;
  kelpieToken: string | null;
  brolgaBaseUrl: string | null;
  brolgaToken: string | null;
  /** Stale after this many minutes without heartbeat (default 15). */
  fleetStaleMinutes: number;
  /** Open cases older than this (hours) count as aging (default 24). */
  caseAgingHours: number;
};

function trim(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

export function loadOpsEnv(
  source: NodeJS.ProcessEnv = process.env,
): OpsEnv {
  return {
    tawnyBaseUrl: trim(source.TAWNY_BASE_URL),
    tawnyToken: trim(source.TAWNY_API_TOKEN),
    kelpieBaseUrl: trim(source.KELPIE_BASE_URL),
    kelpieToken: trim(source.KELPIE_API_TOKEN),
    brolgaBaseUrl: trim(source.BROLGA_BASE_URL),
    brolgaToken: trim(source.BROLGA_API_TOKEN),
    fleetStaleMinutes: Number(source.MUSTER_FLEET_STALE_MINUTES ?? 15) || 15,
    caseAgingHours: Number(source.MUSTER_CASE_AGING_HOURS ?? 24) || 24,
  };
}

export function assertConfigured(
  env: OpsEnv,
  need: Array<"tawny" | "kelpie" | "brolga">,
): void {
  for (const key of need) {
    if (key === "tawny" && !env.tawnyBaseUrl) {
      throw new Error("TAWNY_BASE_URL is not configured");
    }
    if (key === "kelpie" && !env.kelpieBaseUrl) {
      throw new Error("KELPIE_BASE_URL is not configured");
    }
    if (key === "brolga" && !env.brolgaBaseUrl) {
      throw new Error("BROLGA_BASE_URL is not configured");
    }
  }
}
