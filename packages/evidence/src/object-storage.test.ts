import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultObjectStorage } from "./object-storage.ts";

describe("versioned object storage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("downloads the exact immutable version", async () => {
    vi.stubEnv("OBJECT_STORAGE_ENDPOINT", "http://127.0.0.1:9000");
    vi.stubEnv("OBJECT_STORAGE_BUCKET", "muster-evidence");
    const body = new TextEncoder().encode("exact version");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      defaultObjectStorage.getObjectVersion(
        "organisations/test/evidence.bin",
        "immutable-version-1",
      ),
    ).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        search: "?versionId=immutable-version-1",
      }),
      expect.objectContaining({ method: "GET" }),
    );
  });
});
