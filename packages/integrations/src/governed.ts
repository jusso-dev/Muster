import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { z } from "zod";

const JsonSchemaSchema = z.record(z.string(), z.unknown());
const JsonObjectSchema = z.record(z.string(), z.unknown());
const SafeHeaderNameSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9-]{0,63}$/)
  .refine(
    (value) =>
      !["host", "cookie", "content-length"].includes(value.toLowerCase()),
  );

export const ConnectorAuthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("bearer"),
    token: z.string().min(1).max(8_192),
  }),
  z.object({
    type: z.literal("api_key"),
    headerName: SafeHeaderNameSchema,
    token: z.string().min(1).max(8_192),
  }),
  z.object({
    type: z.literal("oauth2_client_credentials"),
    tokenUrl: z.url(),
    clientId: z.string().min(1).max(500),
    clientSecret: z.string().min(1).max(8_192),
    scope: z.string().max(2_000).optional(),
  }),
  z.object({
    type: z.literal("managed_identity"),
    audience: z.string().min(1).max(2_000),
  }),
]);

export const ConnectorLimitsSchema = z.object({
  timeoutMs: z.number().int().min(100).max(120_000).default(10_000),
  maxResponseBytes: z
    .number()
    .int()
    .min(1_024)
    .max(10_000_000)
    .default(1_000_000),
  maxRecords: z.number().int().min(1).max(10_000).default(1_000),
  maxPages: z.number().int().min(1).max(100).default(10),
  requestsPerMinute: z.number().int().min(1).max(6_000).default(60),
});

export const ConnectorConfigurationSchema = z
  .object({
    product: z.enum([
      "defender_endpoint",
      "defender_cloud",
      "sentinel",
      "firewall",
      "cspm",
      "generic_rest",
      "tawny",
      "tawny_response",
      "kelpie",
    ]),
    instanceId: z.string().trim().min(1).max(160),
    displayName: z.string().trim().min(1).max(160),
    baseUrl: z.url(),
    allowedHosts: z.array(z.string().trim().toLowerCase()).min(1).max(20),
    allowPrivateNetwork: z.boolean().default(false),
    testMode: z.boolean().default(false),
    auth: ConnectorAuthSchema,
    limits: ConnectorLimitsSchema.default({
      timeoutMs: 10_000,
      maxResponseBytes: 1_000_000,
      maxRecords: 1_000,
      maxPages: 10,
      requestsPerMinute: 60,
    }),
  })
  .strict();

export const QueryTemplateSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_.-]{1,79}$/),
    version: z.number().int().positive(),
    displayName: z.string().trim().min(1).max(160),
    operation: z.literal("query").optional(),
    method: z.enum(["GET", "POST"]).default("GET"),
    pathTemplate: z.string().startsWith("/").max(1_000),
    requiredCapability: z.enum([
      "tawny.telemetry.read",
      "tawny.hunts.execute",
      "kelpie.cases.read",
      "sentinel.query.execute",
      "alerts.read",
    ]),
    inputSchema: JsonSchemaSchema,
    outputSchema: JsonSchemaSchema,
    bodyInputKey: z.string().max(80).optional(),
    recordsPath: z.string().max(300).optional(),
    cursor: z
      .object({
        responsePath: z.string().min(1).max(300),
        requestParameter: z.string().min(1).max(80),
      })
      .optional(),
  })
  .strict();

export const ExecuteConnectorQuerySchema = z.object({
  templateKey: z.string().min(1).max(80),
  input: JsonObjectSchema.default({}),
  idempotencyKey: z.string().min(8).max(200),
  roomId: z.uuid().optional(),
  taskId: z.uuid().optional(),
});

export type ConnectorConfiguration = z.infer<
  typeof ConnectorConfigurationSchema
>;
export type ConnectorAuth = z.infer<typeof ConnectorAuthSchema>;
export type QueryTemplate = z.infer<typeof QueryTemplateSchema>;
export type ConnectorLimits = z.infer<typeof ConnectorLimitsSchema>;

export type ConnectorFailureCode =
  | "auth_failed"
  | "egress_denied"
  | "invalid_input"
  | "malformed_response"
  | "rate_limited"
  | "response_too_large"
  | "source_unavailable"
  | "timeout";

export class GovernedConnectorError extends Error {
  override readonly name = "GovernedConnectorError";
  constructor(
    readonly code: ConnectorFailureCode,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

function keyBytes(secret: string) {
  const bytes = /^[a-f0-9]{64}$/i.test(secret)
    ? Buffer.from(secret, "hex")
    : Buffer.from(secret, "base64");
  if (bytes.length !== 32)
    throw new Error("CONNECTOR_ENCRYPTION_KEY must encode exactly 32 bytes");
  return bytes;
}

export function encryptConnectorPayload(value: unknown, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptConnectorPayload(
  value: string,
  secret: string,
): unknown {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext)
    throw new Error("Unsupported connector credential envelope");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyBytes(secret),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  );
}

export function encryptConnectorAuth(auth: ConnectorAuth, secret: string) {
  return encryptConnectorPayload(auth, secret);
}

export function decryptConnectorAuth(
  value: string,
  secret: string,
): ConnectorAuth {
  return ConnectorAuthSchema.parse(decryptConnectorPayload(value, secret));
}

export function publicConnectorConfiguration(
  configuration: ConnectorConfiguration,
) {
  const { auth, ...safe } = configuration;
  return {
    ...safe,
    auth: {
      type: auth.type,
      ...(auth.type === "api_key" ? { headerName: auth.headerName } : {}),
      ...(auth.type === "managed_identity" ? { audience: auth.audience } : {}),
      ...(auth.type === "oauth2_client_credentials"
        ? {
            tokenUrl: auth.tokenUrl,
            clientId: auth.clientId,
            scope: auth.scope,
          }
        : {}),
      configured: auth.type !== "none",
    },
  };
}

export function redactUntrusted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactUntrusted);
  if (
    typeof value === "string" &&
    (/^Bearer\s+\S+/i.test(value) ||
      /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) ||
      /(?:api[_-]?key|secret|token)[=:]\s*\S+/i.test(value))
  )
    return "[REDACTED]";
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      /authorization|cookie|password|secret|token|api[-_]?key/i.test(key)
        ? "[REDACTED]"
        : redactUntrusted(item),
    ]),
  );
}

function privateAddress(address: string) {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const normal = address.toLowerCase();
  return (
    normal === "::" ||
    normal === "::1" ||
    normal.startsWith("fc") ||
    normal.startsWith("fd")
  );
}

function loopbackAddress(address: string) {
  return address === "::1" || address.startsWith("127.");
}

function hardDeniedAddress(address: string) {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return a === 0 || (a === 169 && b === 254) || a >= 224;
  }
  const normal = address.toLowerCase();
  return (
    normal === "::" ||
    normal.startsWith("fe8") ||
    normal.startsWith("fe9") ||
    normal.startsWith("fea") ||
    normal.startsWith("feb") ||
    normal.startsWith("ff")
  );
}

export interface SafeTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

export async function resolveSafeTarget(
  rawUrl: string,
  policy: Pick<
    ConnectorConfiguration,
    "allowedHosts" | "allowPrivateNetwork" | "testMode"
  >,
): Promise<SafeTarget> {
  const url = new URL(rawUrl);
  if (!["https:", ...(policy.testMode ? ["http:"] : [])].includes(url.protocol))
    throw new GovernedConnectorError(
      "egress_denied",
      "Connector protocol is not allowed",
    );
  if (url.username || url.password || url.hash)
    throw new GovernedConnectorError(
      "egress_denied",
      "Connector URL credentials and fragments are denied",
    );
  if (!policy.allowedHosts.includes(url.hostname.toLowerCase()))
    throw new GovernedConnectorError(
      "egress_denied",
      "Connector host is outside its allowlist",
    );
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  const allowed = addresses.filter(
    ({ address }) =>
      (!hardDeniedAddress(address) &&
        (policy.allowPrivateNetwork || !privateAddress(address))) ||
      (policy.testMode &&
        policy.allowPrivateNetwork &&
        loopbackAddress(address)),
  );
  if (allowed.length === 0)
    throw new GovernedConnectorError(
      "egress_denied",
      "Connector DNS resolved to a denied network",
    );
  const selected = allowed[0];
  if (!selected)
    throw new GovernedConnectorError(
      "source_unavailable",
      "Connector DNS returned no address",
    );
  return { url, address: selected.address, family: selected.family as 4 | 6 };
}

export function renderTemplatePath(
  template: string,
  input: Record<string, unknown>,
) {
  const rendered = template.replace(
    /\{([A-Za-z][A-Za-z0-9_]*)\}/g,
    (_, key: string) => {
      const value = input[key];
      if (!["string", "number", "boolean"].includes(typeof value))
        throw new GovernedConnectorError(
          "invalid_input",
          `Missing path input ${key}`,
        );
      return encodeURIComponent(String(value));
    },
  );
  let decoded = rendered;
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    throw new GovernedConnectorError(
      "invalid_input",
      "Path contains invalid encoding",
    );
  }
  if (!rendered.startsWith("/") || decoded.split("/").includes(".."))
    throw new GovernedConnectorError(
      "egress_denied",
      "Path traversal is denied",
    );
  return rendered;
}

export function valueAtPath(value: unknown, path?: string): unknown {
  if (!path) return value;
  return path
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      value,
    );
}

interface RequestOptions {
  method: "GET" | "POST" | "PATCH";
  headers: Record<string, string>;
  body?: string;
  limits: ConnectorLimits;
}

async function pinnedJsonRequest(target: SafeTarget, options: RequestOptions) {
  return new Promise<{
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
  }>((resolve, reject) => {
    const request = (
      target.url.protocol === "https:" ? httpsRequest : httpRequest
    )(
      target.url,
      {
        method: options.method,
        headers: options.headers,
        family: target.family,
        lookup: (_hostname, lookupOptions, callback) =>
          callback(
            null,
            lookupOptions.all
              ? [{ address: target.address, family: target.family }]
              : target.address,
            lookupOptions.all ? undefined : target.family,
          ),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.limits.maxResponseBytes) {
            response.destroy();
            reject(
              new GovernedConnectorError(
                "response_too_large",
                "Connector response exceeded configured byte limit",
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            reject(
              new GovernedConnectorError(
                "egress_denied",
                "Connector redirects are denied",
              ),
            );
            return;
          }
          if (status === 401 || status === 403) {
            reject(
              new GovernedConnectorError(
                "auth_failed",
                "Connector authentication failed",
              ),
            );
            return;
          }
          if (status === 429) {
            const retrySeconds = Number(response.headers["retry-after"] ?? 1);
            reject(
              new GovernedConnectorError(
                "rate_limited",
                "Connector rate limit reached",
                Math.min(300_000, Math.max(1_000, retrySeconds * 1_000)),
              ),
            );
            return;
          }
          if (status < 200 || status >= 300) {
            reject(
              new GovernedConnectorError(
                "source_unavailable",
                `Connector returned HTTP ${status}`,
              ),
            );
            return;
          }
          try {
            resolve({
              status,
              headers: response.headers,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            });
          } catch {
            reject(
              new GovernedConnectorError(
                "malformed_response",
                "Connector returned malformed JSON",
              ),
            );
          }
        });
      },
    );
    request.setTimeout(options.limits.timeoutMs, () =>
      request.destroy(
        new GovernedConnectorError("timeout", "Connector request timed out"),
      ),
    );
    request.on("error", (error) =>
      reject(
        error instanceof GovernedConnectorError
          ? error
          : new GovernedConnectorError(
              "source_unavailable",
              "Connector source unavailable",
            ),
      ),
    );
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function authenticationHeaders(
  auth: ConnectorAuth,
  configuration: ConnectorConfiguration,
  managedIdentityTokenProvider?: (audience: string) => Promise<string>,
) {
  if (auth.type === "none") return {};
  if (auth.type === "bearer") return { authorization: `Bearer ${auth.token}` };
  if (auth.type === "api_key") return { [auth.headerName]: auth.token };
  if (auth.type === "managed_identity") {
    if (!managedIdentityTokenProvider)
      throw new GovernedConnectorError(
        "auth_failed",
        "Managed identity is unavailable",
      );
    return {
      authorization: `Bearer ${await managedIdentityTokenProvider(auth.audience)}`,
    };
  }
  const target = await resolveSafeTarget(auth.tokenUrl, configuration);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: auth.clientId,
    client_secret: auth.clientSecret,
    ...(auth.scope ? { scope: auth.scope } : {}),
  }).toString();
  const response = await pinnedJsonRequest(target, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "content-length": String(Buffer.byteLength(body)),
    },
    body,
    limits: configuration.limits,
  });
  const token = z
    .object({ access_token: z.string().min(1) })
    .safeParse(response.body);
  if (!token.success)
    throw new GovernedConnectorError(
      "auth_failed",
      "OAuth token response was invalid",
    );
  return { authorization: `Bearer ${token.data.access_token}` };
}

export async function executeGovernedQuery(input: {
  configuration: ConnectorConfiguration;
  auth: ConnectorAuth;
  template: QueryTemplate;
  values: Record<string, unknown>;
  managedIdentityTokenProvider?: (audience: string) => Promise<string>;
}) {
  const runtimeInputSchema = z.fromJSONSchema(input.template.inputSchema);
  const parsedInput = runtimeInputSchema.safeParse(input.values);
  if (!parsedInput.success)
    throw new GovernedConnectorError(
      "invalid_input",
      "Connector input failed its versioned schema",
    );
  const values = parsedInput.data as Record<string, unknown>;
  const runtimeOutputSchema = z.fromJSONSchema(input.template.outputSchema);
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": "muster-governed-connector/1",
    ...(await authenticationHeaders(
      input.auth,
      input.configuration,
      input.managedIdentityTokenProvider,
    )),
  };
  const records: unknown[] = [];
  let cursor: string | undefined;
  let pages = 0;
  let lastBody: unknown;
  do {
    const path = renderTemplatePath(input.template.pathTemplate, values);
    const url = new URL(path, input.configuration.baseUrl);
    if (cursor && input.template.cursor)
      url.searchParams.set(input.template.cursor.requestParameter, cursor);
    const target = await resolveSafeTarget(url.toString(), input.configuration);
    const bodyValue = input.template.bodyInputKey
      ? values[input.template.bodyInputKey]
      : values;
    const body =
      input.template.method === "POST" ? JSON.stringify(bodyValue) : undefined;
    const response = await pinnedJsonRequest(target, {
      method: input.template.method,
      headers: {
        ...headers,
        ...(body ? { "content-length": String(Buffer.byteLength(body)) } : {}),
      },
      ...(body ? { body } : {}),
      limits: input.configuration.limits,
    });
    const parsed = runtimeOutputSchema.safeParse(response.body);
    if (!parsed.success)
      throw new GovernedConnectorError(
        "malformed_response",
        "Connector response failed its versioned output schema",
      );
    lastBody = parsed.data;
    const pageRecords = valueAtPath(parsed.data, input.template.recordsPath);
    if (Array.isArray(pageRecords)) records.push(...pageRecords);
    if (records.length > input.configuration.limits.maxRecords)
      throw new GovernedConnectorError(
        "response_too_large",
        "Connector response exceeded configured record limit",
      );
    const nextCursor = valueAtPath(
      parsed.data,
      input.template.cursor?.responsePath,
    );
    cursor =
      typeof nextCursor === "string" && nextCursor ? nextCursor : undefined;
    pages += 1;
  } while (cursor && pages < input.configuration.limits.maxPages);
  return {
    data: input.template.recordsPath ? records : lastBody,
    metadata: { pages, records: records.length, truncated: Boolean(cursor) },
  };
}

export async function executeGovernedActionRequest<T>(input: {
  configuration: ConnectorConfiguration;
  auth: ConnectorAuth;
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
  schema: z.ZodType<T>;
}) {
  const path = renderTemplatePath(input.path, {});
  const target = await resolveSafeTarget(
    new URL(path, input.configuration.baseUrl).toString(),
    input.configuration,
  );
  const body =
    input.method === "GET" ? undefined : JSON.stringify(input.body ?? {});
  const response = await pinnedJsonRequest(target, {
    method: input.method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "muster-governed-action/1",
      ...(await authenticationHeaders(input.auth, input.configuration)),
      ...(body ? { "content-length": String(Buffer.byteLength(body)) } : {}),
    },
    ...(body ? { body } : {}),
    limits: input.configuration.limits,
  });
  const parsed = input.schema.safeParse(response.body);
  if (!parsed.success)
    throw new GovernedConnectorError(
      "malformed_response",
      "Connector action response failed its typed schema",
    );
  return parsed.data;
}

export const connectorPresets: Record<string, readonly QueryTemplate[]> = {
  tawny: [
    {
      key: "tawny.inventory.list",
      version: 1,
      displayName: "Tawny endpoint inventory",
      method: "GET",
      pathTemplate: "/api/agents",
      requiredCapability: "tawny.telemetry.read",
      inputSchema: { type: "object", additionalProperties: false },
      outputSchema: { type: "array" },
    },
    {
      key: "tawny.hunt.run",
      version: 1,
      displayName: "Tawny bounded hunt",
      method: "POST",
      pathTemplate: "/api/hunts/run",
      requiredCapability: "tawny.hunts.execute",
      inputSchema: {
        type: "object",
        required: ["query", "limit"],
        properties: {
          query: { type: "string", minLength: 1, maxLength: 20_000 },
          limit: { type: "integer", minimum: 1, maximum: 1_000 },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        required: ["match_count", "matches", "warnings"],
        properties: {
          match_count: { type: "integer", minimum: 0 },
          matches: { type: "array" },
          warnings: { type: "array", items: { type: "string" } },
        },
      },
      recordsPath: "matches",
    },
  ],
  tawny_response: [
    {
      key: "tawny.inventory.list",
      version: 1,
      displayName: "Tawny endpoint inventory for response",
      method: "GET",
      pathTemplate: "/api/agents",
      requiredCapability: "tawny.telemetry.read",
      inputSchema: { type: "object", additionalProperties: false },
      outputSchema: { type: "array" },
    },
  ],
  kelpie: [
    {
      key: "kelpie.cases.list",
      version: 1,
      displayName: "Kelpie cases",
      method: "GET",
      pathTemplate: "/api/v1/cases?limit=100",
      requiredCapability: "kelpie.cases.read",
      inputSchema: { type: "object", additionalProperties: false },
      outputSchema: {
        type: "object",
        required: ["cases"],
        properties: { cases: { type: "array" } },
      },
      recordsPath: "cases",
    },
    {
      key: "kelpie.case.get",
      version: 1,
      displayName: "Kelpie case",
      method: "GET",
      pathTemplate: "/api/v1/cases/{caseId}",
      requiredCapability: "kelpie.cases.read",
      inputSchema: {
        type: "object",
        required: ["caseId"],
        properties: { caseId: { type: "string", minLength: 1 } },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        required: ["id", "caseNumber"],
        properties: {
          id: { type: "string" },
          caseNumber: { type: "string" },
          status: { type: "string" },
          summary: { type: ["string", "null"] },
          version: { type: "integer" },
          observables: { type: "array" },
          recent_timeline: { type: "array" },
        },
      },
    },
    {
      key: "kelpie.observables.search",
      version: 1,
      displayName: "Kelpie observable search",
      method: "GET",
      pathTemplate: "/api/v1/observables?value={value}&exact=true",
      requiredCapability: "kelpie.cases.read",
      inputSchema: {
        type: "object",
        required: ["value"],
        properties: {
          value: { type: "string", minLength: 1, maxLength: 2_000 },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        required: ["observables"],
        properties: { observables: { type: "array" } },
      },
      recordsPath: "observables",
    },
  ],
  defender_endpoint: [
    {
      key: "mde.alerts.list",
      version: 1,
      displayName: "Defender endpoint alerts",
      method: "GET",
      pathTemplate: "/api/alerts",
      requiredCapability: "alerts.read",
      inputSchema: { type: "object", additionalProperties: false },
      outputSchema: {
        type: "object",
        required: ["value"],
        properties: { value: { type: "array" } },
      },
      recordsPath: "value",
      cursor: {
        responsePath: "@odata.nextLink",
        requestParameter: "$skiptoken",
      },
    },
  ],
  defender_cloud: [
    {
      key: "defender_cloud.assessments.list",
      version: 1,
      displayName: "Defender for Cloud assessments",
      method: "GET",
      pathTemplate:
        "/subscriptions/{subscriptionId}/providers/Microsoft.Security/assessments?api-version=2021-06-01",
      requiredCapability: "alerts.read",
      inputSchema: {
        type: "object",
        required: ["subscriptionId"],
        properties: { subscriptionId: { type: "string" } },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        required: ["value"],
        properties: { value: { type: "array" } },
      },
      recordsPath: "value",
    },
  ],
  sentinel: [
    {
      key: "sentinel.log_analytics.query",
      version: 1,
      displayName: "Bounded Log Analytics query",
      method: "POST",
      pathTemplate: "/v1/workspaces/{workspaceId}/query",
      requiredCapability: "sentinel.query.execute",
      inputSchema: {
        type: "object",
        required: ["workspaceId", "query", "timespan"],
        properties: {
          workspaceId: { type: "string" },
          query: { type: "string", maxLength: 20_000 },
          timespan: { type: "string", maxLength: 100 },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        required: ["tables"],
        properties: { tables: { type: "array" } },
      },
      recordsPath: "tables",
    },
  ],
  firewall: [
    {
      key: "firewall.events.list",
      version: 1,
      displayName: "Firewall security events",
      method: "GET",
      pathTemplate: "/api/v1/events",
      requiredCapability: "alerts.read",
      inputSchema: { type: "object", additionalProperties: false },
      outputSchema: { type: "array" },
    },
  ],
  cspm: [
    {
      key: "cspm.findings.list",
      version: 1,
      displayName: "CSPM findings",
      method: "GET",
      pathTemplate: "/api/v1/findings",
      requiredCapability: "alerts.read",
      inputSchema: { type: "object", additionalProperties: false },
      outputSchema: { type: "array" },
    },
  ],
  generic_rest: [],
};
