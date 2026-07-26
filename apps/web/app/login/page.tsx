import Image from "next/image";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh bg-background wide:grid-cols-[minmax(0,1.1fr)_minmax(28rem,0.9fr)]">
      <section className="hidden border-r p-12 wide:flex wide:flex-col wide:justify-between">
        <Image
          src="/muster-logo.png"
          alt="Muster"
          width={48}
          height={48}
          className="size-12 rounded-lg"
          priority
        />
        <div className="max-w-xl">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">
            Bring the signal together.
          </p>
          <h1 className="mt-4 font-display text-4xl font-bold leading-tight tracking-tight">
            The shared workspace for human and agent-driven security operations.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
            Muster connects application telemetry, endpoint detections, security
            investigations and incident case management in one auditable
            workspace.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Self-hosted · organisation scoped · auditable by design
        </p>
      </section>
      <section className="grid place-items-center p-5">
        <div className="w-full max-w-sm">
          <Image
            src="/muster-logo.png"
            alt="Muster"
            width={48}
            height={48}
            className="mb-8 size-12 rounded-lg wide:hidden"
            priority
          />
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Self-hosted security operations
          </p>
          <h2 className="mt-2 font-display text-2xl font-bold">
            Sign in to Muster
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with your organisation account.
          </p>
          <LoginForm />
          <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
            MFA, recovery codes, passkeys, OIDC, and Entra policies are
            supported by the authentication architecture.
          </p>
        </div>
      </section>
    </main>
  );
}
