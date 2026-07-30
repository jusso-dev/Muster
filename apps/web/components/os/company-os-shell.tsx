"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  Activity,
  Bell,
  BookOpen,
  Bot,
  Cable,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  Crosshair,
  LogOut,
  Menu,
  Moon,
  Puzzle,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  X,
} from "lucide-react";
import { authClient } from "@muster/auth/client";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OsCommandPalette } from "@/components/os/os-command-palette";
import { HealthBadge } from "@/components/status/status-badges";
import { useCommandSummary, useSession } from "@/lib/queries/hooks";
import { cn } from "@/lib/utils";
import { toHealthState } from "@/types/status";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  match?: (path: string) => boolean;
};

/**
 * Grouped so the sidebar answers "what kind of thing is this?" before "what
 * page is this?". Each group heading is also the page's eyebrow, so the two
 * never disagree.
 */
const navGroups: Array<{ heading: string; items: NavItem[] }> = [
  {
    heading: "Operate",
    items: [
      {
        href: "/",
        label: "Command",
        icon: Crosshair,
        match: (path) => path === "/",
      },
      { href: "/operations", label: "Operations", icon: ClipboardList },
      { href: "/missions", label: "Missions", icon: Activity },
    ],
  },
  {
    heading: "Workforce",
    items: [
      { href: "/teams", label: "Teams", icon: Users },
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/capabilities", label: "Capabilities", icon: Puzzle },
    ],
  },
  {
    heading: "Govern",
    items: [
      { href: "/approvals", label: "Approvals", icon: CircleCheck },
      { href: "/audit", label: "Audit", icon: ShieldCheck },
    ],
  },
  {
    heading: "Configure",
    items: [
      { href: "/integrations", label: "Integrations", icon: Cable },
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/guides", label: "Guides", icon: BookOpen },
    ],
  },
];

const navItems: NavItem[] = navGroups.flatMap((group) => group.items);

/** Two letters is enough to tell operators apart without a photo service. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : (parts[0]?.[1] ?? "");
  return `${first}${second}`.toUpperCase();
}

function NavLink({
  href,
  label,
  icon: Icon,
  collapsed,
  onNavigate,
  badge,
}: {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  collapsed: boolean;
  onNavigate?: () => void;
  badge?: number;
}) {
  const pathname = usePathname();
  const item = navItems.find((n) => n.href === href);
  const active = item?.match
    ? item.match(pathname)
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      {...(onNavigate ? { onClick: onNavigate } : {})}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        "relative flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-[var(--color-accent-soft)] text-foreground"
          : "text-muted-foreground hover:bg-[var(--color-paper-3)] hover:text-foreground",
        collapsed && "justify-center px-2",
      )}
    >
      {active ? (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[var(--color-accent)]"
        />
      ) : null}
      <Icon
        className={cn(
          "size-4 shrink-0",
          active && "text-[var(--color-accent)]",
        )}
        aria-hidden
      />
      {!collapsed ? <span className="min-w-0 flex-1 truncate">{label}</span> : null}
      {!collapsed && badge && badge > 0 ? (
        <Badge className="min-w-5 justify-center bg-[var(--color-accent)] px-1 text-xs text-primary-foreground">
          {badge > 99 ? "99+" : badge}
        </Badge>
      ) : null}
      {collapsed ? <span className="sr-only">{label}</span> : null}
    </Link>
  );
}

function Sidebar({
  collapsed,
  onToggle,
  onNavigate,
  pendingApprovals,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  pendingApprovals: number;
}) {
  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-border bg-[var(--color-paper)]",
        collapsed ? "w-[3.75rem]" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center gap-2.5 px-4",
          collapsed && "justify-center px-2",
        )}
      >
        <Image
          src="/icons/muster-32.png"
          alt="Muster shield and tree logo"
          width={28}
          height={28}
          className="size-7 shrink-0"
          // Master brand asset: docs/images/muster-logo-master.png
        />
        {!collapsed ? (
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-sm font-semibold tracking-tight">
              Muster
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Security Company OS
            </p>
          </div>
        ) : null}
      </div>

      <nav
        className="flex flex-1 flex-col gap-5 overflow-y-auto px-2.5 py-3"
        aria-label="Primary"
      >
        {navGroups.map((group) => (
          <div key={group.heading} className="flex flex-col gap-1">
            {collapsed ? (
              <div className="mx-2 mb-1 border-t border-border" aria-hidden />
            ) : (
              <p className="px-2.5 pb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                {group.heading}
              </p>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                collapsed={collapsed}
                {...(onNavigate ? { onNavigate } : {})}
                {...(item.href === "/approvals" && pendingApprovals > 0
                  ? { badge: pendingApprovals }
                  : {})}
              />
            ))}
          </div>
        ))}
      </nav>

      <div
        className={cn(
          "flex items-center gap-2 border-t border-border p-3",
          collapsed && "justify-center p-2",
        )}
      >
        {!collapsed ? (
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
            Governed control plane. Chat stays in Slack.
          </p>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="hidden size-8 shrink-0 desktop:inline-flex"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          onClick={onToggle}
        >
          {collapsed ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronLeft className="size-4" />
          )}
        </Button>
      </div>
    </aside>
  );
}

export function CompanyOsShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const session = useSession();
  const command = useCommandSummary();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [chosenOrganisationId, setChosenOrganisationId] = useState("");

  useEffect(() => {
    const current =
      document.documentElement.dataset.theme === "light" ? "light" : "dark";
    setTheme(current);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pendingApprovals = command.data?.pendingApprovalCount ?? 0;
  const overallHealth = toHealthState(command.data?.overallHealth ?? "unknown");
  const org = session.data?.organisation;
  const organisations = session.data?.organisations ?? [];
  // The switcher only earns its interactivity once a second membership exists;
  // with one organisation the top bar states it instead of offering a choice.
  const selectedOrganisationId = chosenOrganisationId || org?.id || "";
  const actor = session.data?.actor;
  const environment = session.data?.environment ?? "unknown";

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem("muster-theme", next);
    } catch {
      /* presentation preference only */
    }
  }

  return (
    <div className="flex min-h-screen bg-[var(--color-paper)] text-foreground">
      <div className="hidden desktop:block">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((value) => !value)}
          pendingApprovals={pendingApprovals}
        />
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 desktop:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[var(--color-overlay)]"
            aria-label="Close navigation overlay"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full w-[min(18rem,88vw)] shadow-2xl">
            <Sidebar
              collapsed={false}
              onToggle={() => setMobileOpen(false)}
              onNavigate={() => setMobileOpen(false)}
              pendingApprovals={pendingApprovals}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="topbar sticky top-0 z-40 flex min-h-14 items-center gap-2 border-b border-border bg-[var(--color-paper)] px-3 tablet:px-4">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="desktop:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-4" />
          </Button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {organisations.length > 1 ? (
                <>
                  <label className="sr-only" htmlFor="org-switcher">
                    Organisation
                  </label>
                  <select
                    id="org-switcher"
                    className="max-w-[12rem] truncate rounded-md border border-border bg-[var(--color-paper-2)] px-2 py-1 text-xs font-medium"
                    value={selectedOrganisationId}
                    onChange={(event) =>
                      setChosenOrganisationId(event.target.value)
                    }
                  >
                    {organisations.map((membership) => (
                      <option key={membership.id} value={membership.id}>
                        {membership.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <p className="max-w-[12rem] truncate text-sm font-semibold">
                  <span className="sr-only">Organisation: </span>
                  {org?.name ??
                    (session.isLoading ? "Loading…" : "Organisation")}
                </p>
              )}
              {session.data?.customer ? (
                <Badge className="hidden bg-muted text-muted-foreground tablet:inline-flex">
                  Customer: {session.data.customer.name}
                </Badge>
              ) : null}
              <Badge className="hidden bg-muted font-mono text-xs text-muted-foreground tablet:inline-flex">
                {environment}
              </Badge>
              <span className="hidden tablet:inline-flex">
                <HealthBadge health={overallHealth} />
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden h-9 w-64 items-center gap-2 rounded-md border border-border bg-[var(--color-paper-2)] px-2.5 text-sm text-muted-foreground transition-colors hover:border-[var(--color-rule-strong)] desktop:inline-flex"
          >
            <Search className="size-4 shrink-0" aria-hidden />
            <span className="flex-1 text-left">Search Muster…</span>
            <kbd className="rounded border border-border px-1 font-mono text-xs">
              ⌘K
            </kbd>
          </button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="desktop:hidden"
            aria-label="Search"
            onClick={() => setPaletteOpen(true)}
          >
            <Search className="size-4" />
          </Button>

          <Link
            href="/approvals"
            aria-label={
              pendingApprovals > 0
                ? `${pendingApprovals} pending approvals`
                : "Approvals"
            }
            className="relative inline-grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--color-paper-3)] hover:text-foreground"
          >
            <Bell className="size-4" aria-hidden />
            {pendingApprovals > 0 ? (
              <span
                aria-hidden
                className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-[var(--color-accent)] px-1 text-center font-mono text-xs font-bold leading-4 text-[var(--color-accent-ink)]"
              >
                {pendingApprovals > 9 ? "9+" : pendingApprovals}
              </span>
            ) : null}
          </Link>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={toggleTheme}
          >
            {theme === "light" ? (
              <Moon className="size-4" />
            ) : (
              <Sun className="size-4" />
            )}
          </Button>

          <div className="hidden items-center gap-2.5 border-l border-border pl-3 tablet:flex">
            <Avatar
              initials={initialsOf(actor?.displayName ?? "Operator")}
              size="sm"
            />
            <div className="min-w-0">
              <p className="max-w-[10rem] truncate text-sm font-medium">
                {actor?.displayName ?? "Operator"}
              </p>
              <p className="max-w-[10rem] truncate text-xs text-muted-foreground">
                {actor?.email ?? "—"}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={() => {
                void authClient.signOut().then(() => router.push("/login"));
              }}
            >
              <LogOut className="size-4" />
            </Button>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="tablet:hidden"
            aria-label="Sign out"
            onClick={() => {
              void authClient.signOut().then(() => router.push("/login"));
            }}
          >
            <LogOut className="size-4" />
          </Button>

          {mobileOpen ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="desktop:hidden"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
            >
              <X className="size-4" />
            </Button>
          ) : null}
        </header>

        <nav
          className="flex gap-1 overflow-x-auto border-b border-border bg-[var(--color-paper)] px-2 py-1 desktop:hidden"
          aria-label="Primary mobile"
        >
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {item.label}
              {item.href === "/approvals" && pendingApprovals > 0
                ? ` (${pendingApprovals})`
                : ""}
            </Link>
          ))}
        </nav>

        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>

      <OsCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

/** Back-compat alias while pages migrate. */
export { CompanyOsShell as OpsShell };
