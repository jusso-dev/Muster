export class UpstreamError extends Error {
  override readonly name = "UpstreamError";
  constructor(
    readonly product: "tawny" | "kelpie" | "brolga",
    readonly operation: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

export type HttpClientOptions = {
  baseUrl: string;
  token?: string | null;
  timeoutMs?: number;
  userAgent?: string;
};

export async function upstreamJson<T>(
  product: UpstreamError["product"],
  operation: string,
  options: HttpClientOptions,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const base = options.baseUrl.replace(/\/$/, "");
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 10_000,
  );
  try {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": options.userAgent ?? "muster-ops/0.1",
      ...(init.headers as Record<string, string> | undefined),
    };
    if (options.token) {
      headers.authorization = `Bearer ${options.token}`;
    }
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers,
    });
    if (!response.ok) {
      const snippet = (await response.text().catch(() => "")).slice(0, 200);
      throw new UpstreamError(
        product,
        operation,
        response.status,
        snippet
          ? `${product} ${operation} HTTP ${response.status}: ${snippet}`
          : `${product} ${operation} HTTP ${response.status}`,
      );
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError(
      product,
      operation,
      null,
      error instanceof Error ? error.message : "unknown upstream failure",
    );
  } finally {
    clearTimeout(timeout);
  }
}
