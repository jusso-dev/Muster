"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { authClient } from "@muster/auth/client";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("justin.middler@yuma.example");
  const [password, setPassword] = useState("MusterDemo!2026");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const result = await authClient.signIn.email({ email, password });
    setLoading(false);
    if (result.error) {
      setError(result.error.message ?? "Authentication failed");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block"><span className="mb-1.5 block text-xs font-semibold">Email address</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 w-full rounded-md border bg-card px-3 text-sm outline-none" /></label>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold">Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full rounded-md border bg-card px-3 text-sm outline-none" /></label>
      {error && <p role="alert" className="error-surface border border-[var(--color-error)] p-2 text-xs text-[var(--color-error)]">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={!hydrated || loading}>{loading ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}{loading ? "Signing in…" : "Sign in securely"}</Button>
      <Button type="button" size="lg" variant="outline" className="w-full"><KeyRound />Sign in with a passkey</Button>
    </form>
  );
}
