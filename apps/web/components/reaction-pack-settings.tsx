"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ImagePlus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { OpsShell } from "@/components/ops-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Asset = {
  id: string;
  name: string;
  altText: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  frameCount: number;
  sha256: string;
  verificationState: string;
};

type Revision = {
  id: string;
  revision: number;
  status: string;
  approvedAt: string | null;
  supersededAt: string | null;
  removedAt: string | null;
  assets: Asset[];
};

type Pack = {
  id: string;
  slug: string;
  displayName: string;
  lifecycle: string;
  revisions: Revision[];
};

function inputClassName() {
  return "h-10 w-full rounded-md border bg-background px-3 text-sm";
}

export function ReactionPackSettings() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/reaction-packs");
      const payload = (await response.json()) as {
        data?: Pack[];
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(payload.detail ?? "Reaction packs unavailable.");
      }
      setPacks(payload.data ?? []);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Reaction packs unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy("create");
    setError("");
    setNotice("");
    try {
      const form = new FormData(formElement);
      const response = await fetch("/api/v1/reaction-packs", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as { detail?: string };
      if (!response.ok) {
        throw new Error(payload.detail ?? "Draft creation failed.");
      }
      formElement.reset();
      setNotice("Draft revision stored. Review its digest before approval.");
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Draft creation failed.",
      );
    } finally {
      setBusy("");
    }
  }

  async function approve(packId: string, revisionId: string) {
    setBusy(revisionId);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/v1/reaction-packs/${packId}/revisions/${revisionId}/approve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      const payload = (await response.json()) as { detail?: string };
      if (!response.ok) {
        throw new Error(payload.detail ?? "Revision approval failed.");
      }
      setNotice("Exact verified revision approved.");
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Revision approval failed.",
      );
    } finally {
      setBusy("");
    }
  }

  async function remove(pack: Pack) {
    if (
      !window.confirm(
        `Remove ${pack.displayName}? Existing messages will show a deterministic unavailable state.`,
      )
    ) {
      return;
    }
    setBusy(pack.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/v1/reaction-packs/${pack.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { detail?: string };
      if (!response.ok) {
        throw new Error(payload.detail ?? "Pack removal failed.");
      }
      setNotice("Pack removed. Metadata and audit history were preserved.");
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Pack removal failed.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <OpsShell>
      <PageHeader
        eyebrow="Organisation administration"
        title="Visual reaction packs"
        description="Curate small decorative packs. They never acknowledge alerts, approve actions, complete tasks, or become authoritative evidence."
        actions={
          <Link
            href="/settings"
            className="inline-flex min-h-9 items-center rounded-md border px-3 text-xs font-semibold hover:bg-muted"
          >
            Back to settings
          </Link>
        }
      />
      <div className="scroll-region overflow-y-auto p-4 tablet:p-6">
        <div className="mx-auto grid max-w-6xl gap-5 desktop:grid-cols-[minmax(0,1fr)_22rem]">
          <section>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold">
                  Curated catalog
                </h2>
                <p className="text-xs text-muted-foreground">
                  Only active packs with one exact approved revision appear in
                  room composers.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => void refresh()}
              >
                <RefreshCw /> Refresh
              </Button>
            </div>
            {loading ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Loading reaction packs…
              </p>
            ) : packs.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed p-8 text-center">
                <ImagePlus className="mx-auto size-6 text-muted-foreground" />
                <p className="mt-2 text-sm font-semibold">
                  No reaction packs installed
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Upload a synthetic or organisation-owned asset as a draft,
                  verify its digest, then approve the exact revision.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {packs.map((pack) => (
                  <article
                    key={pack.id}
                    className="rounded-lg border bg-card p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{pack.displayName}</h3>
                          <Badge>{pack.lifecycle}</Badge>
                        </div>
                        <p className="mono text-xs text-muted-foreground">
                          {pack.slug}
                        </p>
                      </div>
                      {pack.lifecycle === "active" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={Boolean(busy)}
                          onClick={() => void remove(pack)}
                        >
                          <Trash2 /> Remove pack
                        </Button>
                      )}
                    </div>
                    <div className="mt-3 space-y-2">
                      {pack.revisions.map((revision) => (
                        <div
                          key={revision.id}
                          className="rounded border bg-[var(--color-paper-2)] p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold">
                              Revision {revision.revision}{" "}
                              <Badge>{revision.status}</Badge>
                            </p>
                            {revision.status === "draft" &&
                              pack.lifecycle === "active" && (
                                <Button
                                  size="sm"
                                  disabled={Boolean(busy)}
                                  onClick={() =>
                                    void approve(pack.id, revision.id)
                                  }
                                >
                                  <ShieldCheck /> Approve exact revision
                                </Button>
                              )}
                          </div>
                          {revision.assets.map((asset) => (
                            <dl
                              key={asset.id}
                              className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"
                            >
                              <dt className="text-muted-foreground">Asset</dt>
                              <dd>
                                {asset.name} — {asset.altText}
                              </dd>
                              <dt className="text-muted-foreground">Media</dt>
                              <dd>
                                {asset.mimeType}, {asset.width}×{asset.height},{" "}
                                {asset.frameCount} frame
                                {asset.frameCount === 1 ? "" : "s"},{" "}
                                {asset.byteSize} bytes
                              </dd>
                              <dt className="text-muted-foreground">Digest</dt>
                              <dd className="mono break-all">{asset.sha256}</dd>
                              <dt className="text-muted-foreground">State</dt>
                              <dd>{asset.verificationState}</dd>
                            </dl>
                          ))}
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <aside className="rounded-lg border bg-card p-4">
            <h2 className="font-display text-base font-bold">
              Create draft pack
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              PNG, JPEG, WebP, or GIF only. Maximum 512 KiB, 512×512 pixels, and
              24 animation frames.
            </p>
            <form className="mt-4 space-y-3" onSubmit={createDraft}>
              <label className="block text-xs font-semibold">
                Pack name
                <input
                  required
                  name="packDisplayName"
                  maxLength={120}
                  className={`${inputClassName()} mt-1`}
                  placeholder="Synthetic acknowledgements"
                />
              </label>
              <label className="block text-xs font-semibold">
                Pack slug
                <input
                  required
                  name="packSlug"
                  maxLength={80}
                  pattern="[a-z0-9][a-z0-9-]*"
                  className={`${inputClassName()} mt-1`}
                  placeholder="synthetic-acknowledgements"
                />
              </label>
              <label className="block text-xs font-semibold">
                Revision
                <input
                  required
                  name="revision"
                  type="number"
                  min={1}
                  defaultValue={1}
                  className={`${inputClassName()} mt-1`}
                />
              </label>
              <label className="block text-xs font-semibold">
                Asset key
                <input
                  required
                  name="assetName"
                  maxLength={40}
                  pattern="[a-z0-9][a-z0-9-]*"
                  className={`${inputClassName()} mt-1`}
                  placeholder="steady"
                />
              </label>
              <label className="block text-xs font-semibold">
                Accessible alt text
                <input
                  required
                  name="altText"
                  minLength={2}
                  maxLength={160}
                  className={`${inputClassName()} mt-1`}
                  placeholder="A steady synthetic buffalo"
                />
              </label>
              <label className="block text-xs font-semibold">
                Expected SHA-256 (optional)
                <input
                  name="expectedSha256"
                  minLength={64}
                  maxLength={64}
                  pattern="[a-f0-9]{64}"
                  className={`${inputClassName()} mono mt-1`}
                />
              </label>
              <label className="block text-xs font-semibold">
                Image asset
                <input
                  required
                  name="file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="mt-1 block w-full text-xs"
                />
              </label>
              <Button className="w-full" disabled={Boolean(busy)} type="submit">
                <ImagePlus />{" "}
                {busy === "create" ? "Storing draft…" : "Store draft"}
              </Button>
            </form>
          </aside>
        </div>
        {error && (
          <p
            role="alert"
            className="mx-auto mt-4 max-w-6xl rounded border border-[var(--color-error)] p-3 text-sm text-[var(--color-error)]"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="mx-auto mt-4 max-w-6xl rounded border p-3 text-sm"
          >
            {notice}
          </p>
        )}
      </div>
    </OpsShell>
  );
}
