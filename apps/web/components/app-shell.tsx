"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Bell,
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Hash,
  House,
  Menu,
  PanelRightOpen,
  Search,
  Settings,
  SquarePen,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/command-palette";
import {
  demoDirectRooms,
  demoOrganisation,
  demoRooms,
} from "@/lib/demo-data";
import { cn } from "@/lib/utils";

function NavGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <section className="mb-3">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="mb-1 flex min-h-7 w-full items-center gap-1 rounded px-2 text-left text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ChevronDown
          className={cn("size-3 transition-transform", !expanded && "-rotate-90")}
          aria-hidden="true"
        />
        <span className="flex-1">{label}</span>
      </button>
      {expanded && <div className="space-y-0.5">{children}</div>}
    </section>
  );
}

function ChannelLink({
  room,
  onNavigate,
}: {
  room: (typeof demoRooms)[number];
  onNavigate: (() => void) | undefined;
}) {
  const pathname = usePathname();
  const active = pathname === `/rooms/${room.slug}`;
  return (
    <Link
      href={`/rooms/${room.slug}`}
      {...(onNavigate ? { onClick: onNavigate } : {})}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-7 items-center gap-1.5 rounded px-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "sidebar-active font-semibold text-foreground",
        room.unread > 0 && !active && "font-semibold text-foreground",
      )}
    >
      <Hash className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{room.name}</span>
      {room.mentions > 0 ? (
        <Badge className="min-w-5 justify-center bg-[var(--color-accent)] px-1 text-primary-foreground">
          {room.mentions}
        </Badge>
      ) : room.unread > 0 ? (
        <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
      ) : null}
    </Link>
  );
}

function DirectLink({
  room,
  onNavigate,
}: {
  room: (typeof demoDirectRooms)[number];
  onNavigate: (() => void) | undefined;
}) {
  const pathname = usePathname();
  const active = pathname === `/rooms/${room.slug}`;
  return (
    <Link
      href={`/rooms/${room.slug}`}
      {...(onNavigate ? { onClick: onNavigate } : {})}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-8 items-center gap-2 rounded px-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "sidebar-active font-semibold text-foreground",
      )}
    >
      <span className="relative">
        <Avatar initials={room.initials} agent={room.agent} size="sm" />
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-[var(--color-paper-2)]",
            room.presence === "online"
              ? "bg-[var(--color-success)]"
              : "bg-[var(--color-warning)]",
          )}
        />
      </span>
      <span className="min-w-0 flex-1 truncate">{room.name}</span>
      {room.agent && <Badge className="agent-surface px-1 text-[9px]">Agent</Badge>}
    </Link>
  );
}

function QuickLink({
  href,
  label,
  icon: Icon,
  badge,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: typeof House;
  badge?: string;
  onNavigate: (() => void) | undefined;
}) {
  return (
    <Link
      href={href}
      {...(onNavigate ? { onClick: onNavigate } : {})}
      className="flex min-h-8 items-center gap-2 rounded px-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="flex-1">{label}</span>
      {badge && (
        <Badge className="bg-[var(--color-accent)] text-primary-foreground">
          {badge}
        </Badge>
      )}
    </Link>
  );
}

function MainNavigation({
  onNavigate,
  onOpenPalette,
}: {
  onNavigate?: () => void;
  onOpenPalette: () => void;
}) {
  const favourites = demoRooms.filter((room) => room.favourite);
  const channels = demoRooms.filter((room) => !room.favourite);

  return (
    <nav aria-label="Workspace" className="h-full overflow-y-auto px-2 py-2">
      <div className="mb-3 space-y-0.5">
        <QuickLink
          href="/rooms/soc-operations"
          label="Home"
          icon={House}
          onNavigate={onNavigate}
        />
        <QuickLink
          href="/search"
          label="Mentions"
          icon={Bell}
          badge="12"
          onNavigate={onNavigate}
        />
        <QuickLink
          href="/search"
          label="Saved items"
          icon={Bookmark}
          onNavigate={onNavigate}
        />
        <button
          type="button"
          onClick={onOpenPalette}
          className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Search className="size-3.5" />
          <span className="flex-1">Search</span>
          <kbd className="rounded border px-1 text-[9px]">⌘K</kbd>
        </button>
      </div>

      <NavGroup label="Starred">
        {favourites.map((room) => (
          <ChannelLink key={room.slug} room={room} onNavigate={onNavigate} />
        ))}
      </NavGroup>
      <NavGroup label="Channels">
        {channels.map((room) => (
          <ChannelLink key={room.slug} room={room} onNavigate={onNavigate} />
        ))}
      </NavGroup>
      <NavGroup label="Direct messages">
        {demoDirectRooms.map((room) => (
          <DirectLink key={room.slug} room={room} onNavigate={onNavigate} />
        ))}
      </NavGroup>
    </nav>
  );
}

export function AppShell({
  children,
  context,
}: {
  children: ReactNode;
  context?: ReactNode;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const openContext = () => setMobileContextOpen(true);
    window.addEventListener("muster:open-context", openContext);
    return () => window.removeEventListener("muster:open-context", openContext);
  }, []);

  const closeMobileNavigation = () => setMobileNavOpen(false);
  const openPalette = () => {
    setMobileNavOpen(false);
    setPaletteOpen(true);
  };

  return (
    <div className={cn("app-grid", !context && "app-grid-no-context")}>
      <header className="topbar z-40 flex items-center gap-2 border-b bg-background px-2">
        <Button
          variant="ghost"
          size="icon"
          className="desktop:hidden"
          aria-label="Open navigation"
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu />
        </Button>
        <div className="hidden items-center gap-1 desktop:flex">
          <Button variant="ghost" size="icon" aria-label="Go back">
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Go forward">
            <ChevronRight />
          </Button>
        </div>
        <button
          type="button"
          onClick={openPalette}
          className="mx-auto flex h-8 min-w-0 max-w-xl flex-1 items-center gap-2 rounded-md border bg-muted/70 px-3 text-left text-[11px] text-muted-foreground hover:border-[var(--color-rule-strong)]"
        >
          <Search className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">
            Search {demoOrganisation.name}
          </span>
          <kbd className="hidden rounded border bg-background px-1.5 py-0.5 text-[9px] tablet:inline">
            ⌘K
          </kbd>
        </button>
        <div className="flex items-center gap-1">
          <span className="hidden items-center gap-1.5 text-[10px] text-[var(--color-success)] wide:flex">
            <span className="size-1.5 rounded-full bg-[var(--color-success)]" />
            Connected
          </span>
          <Button variant="ghost" size="icon" aria-label="Pending approvals">
            <CircleCheck />
            <span className="sr-only">2 pending approvals</span>
          </Button>
          <Button variant="ghost" size="icon" aria-label="Notifications">
            <Bell />
          </Button>
          {context && (
            <Button
              variant="ghost"
              size="icon"
              className="context-mobile-trigger"
              aria-label="Open context panel"
              onClick={() => setMobileContextOpen(true)}
            >
              <PanelRightOpen />
            </Button>
          )}
          <button
            type="button"
            className="ml-1 rounded-md"
            aria-label="User menu and theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title="Toggle theme"
          >
            <Avatar initials="JM" />
          </button>
        </div>
      </header>

      <aside className="navigation-sidebar hidden min-h-0 border-r bg-[var(--color-paper-2)] desktop:flex desktop:flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Image src="/icon.svg" alt="" width={28} height={28} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold">Muster</p>
            <p className="truncate text-[9px] text-muted-foreground">
              Yuma Security Operations
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 min-h-8"
            aria-label="New message"
            onClick={openPalette}
          >
            <SquarePen />
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <MainNavigation onOpenPalette={openPalette} />
        </div>
        <div className="flex items-center gap-2 border-t p-2">
          <Avatar initials="JM" size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold">Justin Middler</p>
            <p className="truncate text-[9px] text-muted-foreground">
              Security Lead
            </p>
          </div>
          <Link
            href="/settings"
            className="grid size-8 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Settings"
          >
            <Settings className="size-3.5" />
          </Link>
        </div>
      </aside>

      <main className="main-workspace flex min-h-0 flex-col bg-background">
        {children}
      </main>
      {context && (
        <aside
          className={cn(
            "context-panel min-h-0 border-l bg-[var(--color-paper-2)]",
            mobileContextOpen && "mobile-context-open",
          )}
        >
          {context}
        </aside>
      )}
      {context && mobileContextOpen && (
        <button
          type="button"
          className="mobile-context-backdrop"
          aria-label="Close context panel"
          onClick={() => setMobileContextOpen(false)}
        />
      )}

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 bg-[var(--color-overlay)] desktop:hidden">
          <aside className="flex h-full w-[min(20rem,88vw)] flex-col border-r bg-background shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b px-3">
              <span className="font-display text-sm font-bold">Muster</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={closeMobileNavigation}
                aria-label="Close navigation"
              >
                <X />
              </Button>
            </div>
            <MainNavigation
              onNavigate={closeMobileNavigation}
              onOpenPalette={openPalette}
            />
          </aside>
        </div>
      )}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
