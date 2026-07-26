import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh bg-background wide:grid-cols-[minmax(0,1.1fr)_minmax(28rem,0.9fr)]">
      <section className="hidden border-r p-12 wide:flex wide:flex-col wide:justify-between">
        <div className="grid size-11 place-items-center rounded-md bg-primary font-display text-lg font-black text-primary-foreground">M</div>
        <div className="max-w-xl">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">Bring the signal together.</p>
          <h1 className="mt-4 font-display text-4xl font-bold leading-tight tracking-tight">The shared workspace for human and agent-driven security operations.</h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">Muster connects application telemetry, endpoint detections, security investigations and incident case management in one auditable workspace.</p>
        </div>
        <p className="text-xs text-muted-foreground">Self-hosted · organisation scoped · auditable by design</p>
      </section>
      <section className="grid place-items-center p-5">
        <div className="w-full max-w-sm">
          <div className="mb-8 grid size-10 place-items-center rounded-md bg-primary font-display font-black text-primary-foreground wide:hidden">M</div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Yuma Security Operations</p>
          <h2 className="mt-2 font-display text-2xl font-bold">Sign in to Muster</h2>
          <p className="mt-2 text-sm text-muted-foreground">Use the seeded local administrator account.</p>
          <LoginForm />
          <p className="mt-6 text-center text-[11px] leading-5 text-muted-foreground">Local demo credentials are synthetic. MFA, recovery codes, passkeys, OIDC, and Entra policies are supported by the authentication architecture.</p>
        </div>
      </section>
    </main>
  );
}
