"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

export type VisualReactionAssetData = {
  id: string;
  revisionId: string;
  sha256: string;
  altText: string;
  frameCount?: number;
  url?: string;
};

export function VisualReactionAsset({
  asset,
  compact = false,
}: {
  asset: VisualReactionAssetData;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src =
    asset.url ??
    `/api/v1/reaction-assets/${asset.id}?revision=${asset.revisionId}&digest=${asset.sha256}`;

  if (failed) {
    return (
      <span
        role="img"
        aria-label={`${asset.altText}. Reaction unavailable.`}
        className={cn(
          "inline-flex items-center gap-1 rounded border border-dashed bg-muted text-xs text-muted-foreground",
          compact ? "min-h-12 px-2 py-1" : "min-h-24 px-4 py-3",
        )}
      >
        <ImageOff className="size-4" aria-hidden="true" />
        Reaction unavailable
      </span>
    );
  }

  return (
    <>
      <img
        src={src}
        alt={asset.altText}
        width={compact ? 56 : 160}
        height={compact ? 56 : 160}
        className={cn(
          "object-contain",
          compact ? "size-14" : "max-h-40 max-w-40",
          (asset.frameCount ?? 1) > 1 && "motion-reduce:hidden",
        )}
        onError={() => setFailed(true)}
      />
      {(asset.frameCount ?? 1) > 1 && (
        <span
          role="img"
          aria-label={`${asset.altText}. Animation paused for reduced motion.`}
          className={cn(
            "hidden items-center justify-center rounded border bg-muted text-center text-xs text-muted-foreground motion-reduce:inline-flex",
            compact ? "size-14 p-1" : "min-h-24 min-w-32 p-3",
          )}
        >
          {asset.altText}
        </span>
      )}
    </>
  );
}
