import { createHash, createHmac } from "node:crypto";

export type EvidenceObject = {
  storageKey: string;
  contentType: string;
  body: Uint8Array;
};

export interface EvidenceObjectStorage {
  putObject(object: EvidenceObject): Promise<void>;
}

export interface ContentObjectStorage extends EvidenceObjectStorage {
  getObject(storageKey: string): Promise<Uint8Array>;
}

export interface CleanupObjectStorage extends ContentObjectStorage {
  getObjectVersion(storageKey: string, versionId: string): Promise<Uint8Array>;
  headObject(
    storageKey: string,
    versionId: string,
  ): Promise<{
    size: number;
    etag: string;
    versionId: string;
    legalHold: boolean;
    objectLockMetadata: Record<string, string>;
  } | null>;
  deleteObject(storageKey: string, versionId: string): Promise<void>;
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function objectUrl(endpoint: string, bucket: string, storageKey: string) {
  const url = new URL(endpoint);
  const basePath = url.pathname.replace(/\/$/, "");
  const encodedKey = storageKey
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  url.pathname = `${basePath}/${encodeURIComponent(bucket)}/${encodedKey}`;
  return url;
}

function signingHeaders(
  method: "DELETE" | "GET" | "HEAD" | "PUT",
  url: URL,
  body: Uint8Array,
  region: string,
  accessKey: string,
  secretKey: string,
  contentType?: string,
) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const canonicalHeaders = [
    ...(contentType ? [`content-type:${contentType}`] : []),
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ].join("\n");
  const signedHeaders = contentType
    ? "content-type;host;x-amz-content-sha256;x-amz-date"
    : "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    url.pathname,
    [...url.searchParams.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      )
      .join("&"),
    canonicalHeaders,
    "",
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n");
  const dateKey = hmac(`AWS4${secretKey}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");
  return {
    ...(contentType ? { "content-type": contentType } : {}),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope},` +
      ` SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function storageConfiguration() {
  return {
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT ?? "http://127.0.0.1:9000",
    bucket: process.env.OBJECT_STORAGE_BUCKET ?? "muster-evidence",
    region: process.env.OBJECT_STORAGE_REGION ?? "us-east-1",
    accessKey: process.env.OBJECT_STORAGE_ACCESS_KEY ?? "muster",
    secretKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? "local-minio-secret",
  };
}

export const defaultObjectStorage: CleanupObjectStorage = {
  async putObject(object) {
    const { endpoint, bucket, region, accessKey, secretKey } =
      storageConfiguration();
    const url = objectUrl(endpoint, bucket, object.storageKey);
    const response = await fetch(url, {
      method: "PUT",
      headers: signingHeaders(
        "PUT",
        url,
        object.body,
        region,
        accessKey,
        secretKey,
        object.contentType,
      ),
      body: Buffer.from(object.body),
    });
    if (!response.ok) {
      throw new Error(
        `Object storage rejected upload with status ${response.status}`,
      );
    }
  },
  async getObject(storageKey) {
    const { endpoint, bucket, region, accessKey, secretKey } =
      storageConfiguration();
    const url = objectUrl(endpoint, bucket, storageKey);
    const emptyBody = new Uint8Array();
    const response = await fetch(url, {
      method: "GET",
      headers: signingHeaders(
        "GET",
        url,
        emptyBody,
        region,
        accessKey,
        secretKey,
      ),
    });
    if (!response.ok) {
      throw new Error(
        `Object storage rejected download with status ${response.status}`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  },
  async headObject(storageKey, versionId) {
    const { endpoint, bucket, region, accessKey, secretKey } =
      storageConfiguration();
    const url = objectUrl(endpoint, bucket, storageKey);
    if (versionId !== "unversioned") {
      url.searchParams.set("versionId", versionId);
    }
    const emptyBody = new Uint8Array();
    const response = await fetch(url, {
      method: "HEAD",
      headers: signingHeaders(
        "HEAD",
        url,
        emptyBody,
        region,
        accessKey,
        secretKey,
      ),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `Object storage rejected metadata request with status ${response.status}`,
      );
    }
    const size = Number(response.headers.get("content-length"));
    const etag = response.headers.get("etag")?.replace(/^"|"$/g, "");
    const actualVersionId =
      response.headers.get("x-amz-version-id") ?? "unversioned";
    if (!Number.isSafeInteger(size) || size < 0 || !etag || !actualVersionId) {
      throw new Error("Object storage returned incomplete version metadata");
    }
    const objectLockMetadata = Object.fromEntries(
      ["x-amz-object-lock-mode", "x-amz-object-lock-retain-until-date"]
        .map((header) => [header, response.headers.get(header)] as const)
        .filter((entry): entry is readonly [string, string] =>
          Boolean(entry[1]),
        ),
    );
    return {
      size,
      etag,
      versionId: actualVersionId,
      legalHold:
        response.headers.get("x-amz-object-lock-legal-hold")?.toUpperCase() ===
        "ON",
      objectLockMetadata,
    };
  },
  async getObjectVersion(storageKey, versionId) {
    const { endpoint, bucket, region, accessKey, secretKey } =
      storageConfiguration();
    const url = objectUrl(endpoint, bucket, storageKey);
    url.searchParams.set("versionId", versionId);
    const emptyBody = new Uint8Array();
    const response = await fetch(url, {
      method: "GET",
      headers: signingHeaders(
        "GET",
        url,
        emptyBody,
        region,
        accessKey,
        secretKey,
      ),
    });
    if (!response.ok) {
      throw new Error(
        `Object storage rejected version download with status ${response.status}`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  },
  async deleteObject(storageKey, versionId) {
    const { endpoint, bucket, region, accessKey, secretKey } =
      storageConfiguration();
    const url = objectUrl(endpoint, bucket, storageKey);
    if (versionId !== "unversioned") {
      url.searchParams.set("versionId", versionId);
    }
    const emptyBody = new Uint8Array();
    const response = await fetch(url, {
      method: "DELETE",
      headers: signingHeaders(
        "DELETE",
        url,
        emptyBody,
        region,
        accessKey,
        secretKey,
      ),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Object storage rejected version deletion with status ${response.status}`,
      );
    }
  },
};

export const defaultEvidenceObjectStorage: EvidenceObjectStorage =
  defaultObjectStorage;
