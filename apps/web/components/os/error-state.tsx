import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api/client";

export function ErrorState({
  error,
  onRetry,
  title = "Unable to load",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const detail =
    error instanceof ApiClientError
      ? error.detail
      : error instanceof Error
        ? error.message
        : "An unexpected error occurred.";
  const status = error instanceof ApiClientError ? error.status : undefined;
  const permissionDenied = status === 403;

  return (
    <div
      role="alert"
      className="rounded-md border border-[var(--color-error)]/40 bg-[var(--color-error-soft)] p-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-[var(--color-error)]"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[var(--color-error)]">
            {permissionDenied ? "Permission denied" : title}
          </h2>
          <p className="mt-1 text-xs text-foreground/90">{detail}</p>
          {error instanceof ApiClientError && error.traceId ? (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              trace {error.traceId}
            </p>
          ) : null}
          {onRetry && !permissionDenied ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={onRetry}
            >
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
