"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  Activity,
  Bot,
  Cable,
  CircleCheck,
  LogOut,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  Workflow,
} from "lucide-react";
import { authClient } from "@muster/auth/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/", label: "Health", icon: Activity },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/approvals", label: "Approvals", icon: CircleCheck },
  { href: "/integrations/connectors", label: "Integrations", icon: Cable },
  { href: "/settings/slack", label: "Slack", icon: Workflow },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function NavLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof Activity;
}) {
  const pathname = usePathname();
  const active =
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-9 items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}

export function OpsShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const theme =
    typeof document !== "undefined"
      ? document.documentElement.dataset.theme
      : undefined;

  return (
    <div className="flex min-h-screen bg-[var(--color-paper-2)] text-foreground">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-[var(--color-paper)] desktop:flex">
        <div className="flex items-center gap-2 border-b border-border px-3 py-3">
          <ShieldCheck className="size-5 text-[var(--color-signal)]" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Muster</p>
            <p className="truncate text-[11px] text-muted-foreground">
              Control plane
            </p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2" aria-label="Ops">
          {nav.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </nav>
        <div className="border-t border-border p-2 text-[11px] text-muted-foreground">
          Chat lives in Slack. This UI is health and wiring only.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-12 items-center justify-between gap-2 border-b border-border bg-[var(--color-paper)] px-3 py-2">
          <div className="desktop:hidden">
            <p className="text-sm font-semibold">Muster</p>
          </div>
          <p className="hidden text-xs text-muted-foreground desktop:block">
            Governed agents · Kelpie remains case SoR
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Toggle theme"
              onClick={() => {
                const next =
                  document.documentElement.dataset.theme === "light"
                    ? "dark"
                    : "light";
                document.documentElement.dataset.theme = next;
                try {
                  localStorage.setItem("muster-theme", next);
                } catch {
                  /* ignore */
                }
              }}
            >
              {theme === "light" ? (
                <Moon className="size-4" />
              ) : (
                <Sun className="size-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void authClient.signOut().then(() => router.push("/login"));
              }}
            >
              <LogOut className="size-4" />
              <span className="sr-only desktop:not-sr-only desktop:ml-1">
                Sign out
              </span>
            </Button>
          </div>
        </header>

        <nav
          className="flex gap-1 overflow-x-auto border-b border-border bg-[var(--color-paper)] px-2 py-1 desktop:hidden"
          aria-label="Ops mobile"
        >
          {nav.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </nav>

        <main className="min-h-0 flex-1 overflow-auto p-4">{children}</main>
      </div>
    </div>
  );
}
