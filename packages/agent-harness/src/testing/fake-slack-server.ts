import { createServer, type Server } from "node:http";

export type FakeSlackRequest = {
  method: string;
  path: string;
  authorization?: string;
  body: string;
};

export class FakeSlackServer {
  readonly requests: FakeSlackRequest[] = [];
  private server: Server | undefined;
  private origin: string | undefined;
  private tokenSequence = 0;
  private readonly rateLimits = new Map<string, number>();

  constructor(
    private readonly options: {
      teamId: string;
      teamName: string;
      botUserId: string;
      requiredScopes: readonly string[];
    },
  ) {}

  async start() {
    if (process.env.NODE_ENV !== "test")
      throw new Error("Fake Slack server is available only in test mode");
    if (this.server) throw new Error("Fake Slack server is already running");
    this.server = createServer(async (request, response) => {
      const body = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () =>
          resolve(Buffer.concat(chunks).toString("utf8")),
        );
        request.on("error", reject);
      });
      const path = new URL(request.url ?? "/", "http://fake.slack").pathname;
      this.requests.push({
        method: request.method ?? "GET",
        path,
        ...(request.headers.authorization
          ? { authorization: request.headers.authorization }
          : {}),
        body,
      });
      response.setHeader("content-type", "application/json");

      if (path === "/api/oauth.v2.access") {
        const code = new URLSearchParams(body).get("code");
        this.tokenSequence += 1;
        const scopes =
          code === "missing-scopes"
            ? this.options.requiredScopes.filter(
                (scope) => scope !== "commands",
              )
            : this.options.requiredScopes;
        response.end(
          JSON.stringify({
            ok: true,
            access_token: `xoxb-synthetic-${this.tokenSequence}`,
            bot_user_id: this.options.botUserId,
            team: {
              id: this.options.teamId,
              name: this.options.teamName,
            },
            scope: scopes.join(","),
          }),
        );
        return;
      }

      const method = path.startsWith("/api/") ? path.slice("/api/".length) : "";
      const remainingLimits = this.rateLimits.get(method) ?? 0;
      if (remainingLimits > 0) {
        this.rateLimits.set(method, remainingLimits - 1);
        response.statusCode = 429;
        response.setHeader("retry-after", "0");
        response.end(JSON.stringify({ ok: false, error: "ratelimited" }));
        return;
      }
      response.end(
        JSON.stringify({
          ok: true,
          ts: `1710000000.${String(this.requests.length).padStart(6, "0")}`,
        }),
      );
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new Error("Fake Slack server did not bind an HTTP port");
    this.origin = `http://127.0.0.1:${address.port}`;
    return this.apiBaseUrl;
  }

  get apiBaseUrl() {
    if (!this.origin) throw new Error("Fake Slack server is not running");
    return `${this.origin}/api/`;
  }

  rateLimitOnce(method: string) {
    this.rateLimits.set(method, 1);
  }

  requestsFor(method: string) {
    return this.requests.filter((request) => request.path === `/api/${method}`);
  }

  async stop() {
    const server = this.server;
    this.server = undefined;
    this.origin = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
