export const REDACTION_MARKER = "[REDACTED]";
export const TRUNCATION_MARKER = "[TRUNCATED]";
export const CIRCULAR_MARKER = "[CIRCULAR]";
export const UNSERIALISABLE_MARKER = "[UNSERIALISABLE]";

export type RedactionOptions = {
  maxDepth?: number;
  maxItems?: number;
  maxStringLength?: number;
};

type RequiredRedactionOptions = Required<RedactionOptions>;

const DEFAULT_OPTIONS: RequiredRedactionOptions = {
  maxDepth: 8,
  maxItems: 100,
  maxStringLength: 10_000,
};

const SENSITIVE_NAMES = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "token",
  "secret",
  "password",
  "passwd",
  "passphrase",
  "apikey",
  "xapikey",
  "clientsecret",
  "privatekey",
  "secretaccesskey",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "sessionsecret",
  "credential",
  "credentials",
  "connectorcredential",
  "encryptedcredential",
]);

const SENSITIVE_SUFFIXES = [
  "token",
  "secret",
  "password",
  "passwd",
  "passphrase",
  "apikey",
  "clientsecret",
  "privatekey",
  "secretaccesskey",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "sessionsecret",
];

function normaliseName(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function isSecretName(value: string): boolean {
  const normalised = normaliseName(value);
  return SENSITIVE_NAMES.has(normalised)
    || SENSITIVE_SUFFIXES.some((suffix) => normalised.endsWith(suffix))
    || ["password", "passphrase", "apikey", "clientsecret", "privatekey", "credential"].some((part) =>
      normalised.includes(part),
    );
}

function isEnvironmentSecretName(value: string): boolean {
  const normalised = normaliseName(value);
  return isSecretName(value) || normalised.endsWith("token") || normalised.endsWith("secret");
}

export function redactObservationText(value: string, options: RedactionOptions = {}): string {
  const limits = { ...DEFAULT_OPTIONS, ...options };
  const boundedInput = value.slice(0, limits.maxStringLength);
  const redacted = boundedInput
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gi,
      REDACTION_MARKER,
    )
    .replace(/\b(authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic)?\s*[^\s,;]+/gi, `$1: ${REDACTION_MARKER}`)
    .replace(/\b(cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi, `$1: ${REDACTION_MARKER}`)
    .replace(
      /\b(password|passwd|passphrase|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|session[_-]?token|private[_-]?key|aws[_-]?secret[_-]?access[_-]?key)\b\s*["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^,;\s}]+)/gi,
      `$1=${REDACTION_MARKER}`,
    )
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^/@\s:]+):([^/@\s]+)@/gi, `$1${REDACTION_MARKER}@`)
    .replace(/\b(?:eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}|(?:sk|pk|ghp|gho|github_pat)_[a-zA-Z0-9_-]{12,})\b/g, REDACTION_MARKER);

  return value.length > limits.maxStringLength
    ? `${redacted}${TRUNCATION_MARKER}`
    : redacted;
}

function boundedEntries<T>(values: T[], maxItems: number): Array<T | typeof TRUNCATION_MARKER> {
  return values.length > maxItems
    ? [...values.slice(0, maxItems), TRUNCATION_MARKER]
    : values;
}

export function redactForObservation(value: unknown, options: RedactionOptions = {}): unknown {
  const limits = { ...DEFAULT_OPTIONS, ...options };
  const ancestors = new WeakSet<object>();

  const visit = (current: unknown, depth: number, secret = false): unknown => {
    if (secret) return REDACTION_MARKER;
    if (typeof current === "string") return redactObservationText(current, limits);
    if (current === null || typeof current === "boolean" || typeof current === "number") return current;
    if (typeof current === "undefined") return undefined;
    if (typeof current === "bigint") return current.toString();
    if (typeof current === "symbol" || typeof current === "function") return UNSERIALISABLE_MARKER;
    if (depth >= limits.maxDepth) return TRUNCATION_MARKER;
    if (ancestors.has(current)) return CIRCULAR_MARKER;

    ancestors.add(current);
    try {
      if (current instanceof Date) return current.toISOString();
      if (current instanceof URL) return redactObservationText(current.toString(), limits);
      if (current instanceof Error) {
        return {
          name: redactObservationText(current.name, limits),
          message: redactObservationText(current.message, limits),
          stack: current.stack ? redactObservationText(current.stack, limits) : undefined,
        };
      }

      if (Array.isArray(current)) {
        const envPair = current.length >= 2
          && typeof current[0] === "string"
          && isEnvironmentSecretName(current[0]);
        return boundedEntries(current, limits.maxItems).map((item, index) =>
          item === TRUNCATION_MARKER
            ? item
            : visit(item, depth + 1, envPair && index === 1),
        );
      }

      if (current instanceof Map) {
        return boundedEntries([...current.entries()], limits.maxItems).map((entry) => {
          if (entry === TRUNCATION_MARKER) return entry;
          const [key, entryValue] = entry;
          const secretValue = typeof key === "string" && isSecretName(key);
          return [visit(key, depth + 1), visit(entryValue, depth + 1, secretValue)];
        });
      }

      if (current instanceof Set) {
        return boundedEntries([...current.values()], limits.maxItems).map((item) =>
          item === TRUNCATION_MARKER ? item : visit(item, depth + 1),
        );
      }

      const record = current as Record<string, unknown>;
      const keys = boundedEntries(Object.keys(record), limits.maxItems);
      const envNameKey = Object.keys(record).find((key) => {
        const normalised = normaliseName(key);
        return normalised === "name" || normalised === "key";
      });
      let envPairSecret = false;
      if (envNameKey) {
        try {
          const envName = record[envNameKey];
          envPairSecret = typeof envName === "string" && isEnvironmentSecretName(envName);
        } catch {
          envPairSecret = false;
        }
      }

      const result: Record<string, unknown> = {};
      for (const key of keys) {
        if (key === TRUNCATION_MARKER) {
          result[TRUNCATION_MARKER] = TRUNCATION_MARKER;
          continue;
        }
        try {
          const isValueInSecretEnvPair = envPairSecret && normaliseName(key) === "value";
          result[key] = visit(record[key], depth + 1, isSecretName(key) || isValueInSecretEnvPair);
        } catch {
          result[key] = UNSERIALISABLE_MARKER;
        }
      }
      return result;
    } catch {
      return UNSERIALISABLE_MARKER;
    } finally {
      ancestors.delete(current);
    }
  };

  return visit(value, 0);
}
