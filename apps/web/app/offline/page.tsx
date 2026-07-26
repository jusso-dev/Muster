import { CloudOff, RefreshCw } from "lucide-react";

export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-6">
      <section className="max-w-md text-left">
        <CloudOff className="mb-5 size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="font-display text-2xl font-bold">Muster is offline</h1>
        <p className="mt-3 max-w-[60ch] text-muted-foreground">
          Sensitive rooms, cases, and evidence are not stored for offline access.
          Unsent message drafts remain on this device.
        </p>
        <a
          href="/"
          className="button-motion mt-6 inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-secondary px-4 font-semibold"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Try connection
        </a>
      </section>
    </main>
  );
}
