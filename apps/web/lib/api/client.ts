import type { ApiEnvelope, ProblemBody } from "@/types/os";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail: string,
    readonly traceId?: string,
  ) {
    super(detail || title);
    this.name = "ApiClientError";
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  searchParams?: Record<string, string | number | boolean | undefined | null>;
};

function buildUrl(
  path: string,
  searchParams?: RequestOptions["searchParams"],
): string {
  const url = path.startsWith("http")
    ? new URL(path)
    : new URL(path, typeof window !== "undefined" ? window.location.origin : "http://localhost");
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return path.startsWith("http") ? url.toString() : `${url.pathname}${url.search}`;
}

/**
 * Typed browser/server-safe API helper.
 * Always uses session cookies; never accepts org/actor IDs as authz input.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiEnvelope<T>> {
  const init: RequestInit = {
    method: options.method ?? "GET",
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(options.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
    },
  };
  if (options.signal) init.signal = options.signal;
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  const response = await fetch(buildUrl(path, options.searchParams), init);

  if (response.status === 401 && typeof window !== "undefined") {
    const next = encodeURIComponent(
      `${window.location.pathname}${window.location.search}`,
    );
    window.location.href = `/login?next=${next}`;
    throw new ApiClientError(401, "Unauthorised", "Authentication is required.");
  }

  const payload = (await response.json().catch(() => null)) as
    | (ApiEnvelope<T> & ProblemBody)
    | null;

  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      payload?.title ?? "Request failed",
      payload?.detail ?? `HTTP ${response.status}`,
      payload?.traceId,
    );
  }

  if (!payload || !("data" in payload)) {
    throw new ApiClientError(
      500,
      "Invalid response",
      "API response missing data envelope.",
    );
  }

  return payload as ApiEnvelope<T>;
}

export async function apiGet<T>(
  path: string,
  searchParams?: RequestOptions["searchParams"],
  signal?: AbortSignal,
) {
  const options: RequestOptions = {};
  if (searchParams) options.searchParams = searchParams;
  if (signal) options.signal = signal;
  return apiRequest<T>(path, options);
}

export async function apiPost<T>(path: string, body: unknown, signal?: AbortSignal) {
  const options: RequestOptions = { method: "POST", body };
  if (signal) options.signal = signal;
  return apiRequest<T>(path, options);
}

export async function apiPatch<T>(path: string, body: unknown, signal?: AbortSignal) {
  const options: RequestOptions = { method: "PATCH", body };
  if (signal) options.signal = signal;
  return apiRequest<T>(path, options);
}
