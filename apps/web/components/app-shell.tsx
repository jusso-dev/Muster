"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  ListTodo,
  LogOut,
  Menu,
  Moon,
  PanelRightOpen,
  Search,
  Settings,
  SquarePen,
  Sun,
  X,
} from "lucide-react";
import { authClient } from "@muster/auth/client";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/command-palette";
import {
  demoDirectRooms,
  demoMode,
  demoOrganisation,
  demoRooms,
} from "@/lib/demo-data";
import { cn } from "@/lib/utils";

type NavigationRoom = {
  id: string;
  slug: string;
  displayName: string;
  topic: string;
  roomType: string;
  favourite: boolean | null;
  muted: boolean | null;
  sidebarPosition: number | null;
  sidebarGroup: string | null;
  unreadCount?: number;
  mentionCount?: number;
};

const initialNavigationRooms: NavigationRoom[] = [
  ...demoRooms.map((room) => ({
    id: roomIdFromSlug(room.slug),
    slug: room.slug,
    displayName: room.name,
    topic: room.topic,
    roomType: "operations",
    favourite: room.favourite,
    muted: false,
    sidebarPosition: 0,
    sidebarGroup: null,
    unreadCount: room.unread,
    mentionCount: room.mentions,
  })),
  ...demoDirectRooms.map((room) => ({
    id: roomIdFromSlug(room.slug),
    slug: room.slug,
    displayName: room.name,
    topic: room.topic,
    roomType: "direct",
    favourite: false,
    muted: false,
    sidebarPosition: 0,
    sidebarGroup: null,
    unreadCount: 0,
    mentionCount: 0,
  })),
];

function roomIdFromSlug(slug: string) {
  return `demo:${slug}`;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <section className="mb-3">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="mb-1 flex min-h-7 w-full items-center gap-1 rounded px-2 text-left text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ChevronDown
          className={cn(
            "size-3 transition-transform",
            !expanded && "-rotate-90",
          )}
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
  room: NavigationRoom;
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
        "flex min-h-7 items-center gap-1.5 rounded px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "sidebar-active font-semibold text-foreground",
        Boolean(room.unreadCount) && !active && "font-semibold text-foreground",
      )}
    >
      <Hash className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{room.displayName}</span>
      {room.muted && <span className="sr-only">Muted</span>}
      {Boolean(room.mentionCount) ? (
        <Badge className="min-w-5 justify-center bg-[var(--color-accent)] px-1 text-primary-foreground">
          {room.mentionCount}
        </Badge>
      ) : Boolean(room.unreadCount) ? (
        <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
      ) : null}
    </Link>
  );
}

function DirectLink({
  room,
  onNavigate,
}: {
  room: NavigationRoom;
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
        "flex min-h-8 items-center gap-2 rounded px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "sidebar-active font-semibold text-foreground",
      )}
    >
      <span className="relative">
        <Avatar initials={initials(room.displayName)} size="sm" />
        <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-[var(--color-paper-2)] bg-[var(--color-success)]" />
      </span>
      <span className="min-w-0 flex-1 truncate">{room.displayName}</span>
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
      className="flex min-h-8 items-center gap-2 rounded px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
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
  const [rooms, setRooms] = useState(initialNavigationRooms);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/rooms?membership=joined", {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          data: NavigationRoom[];
        };
        setRooms(payload.data);
      })
      .catch(() => undefined)
      .finally(() => setRoomsLoaded(true));
    return () => controller.abort();
  }, []);
  const favourites = rooms.filter(
    (room) => room.favourite && room.roomType !== "direct",
  );
  const channels = rooms.filter(
    (room) => !room.favourite && room.roomType !== "direct",
  );
  const channelGroups = new Map<string, NavigationRoom[]>();
  for (const room of channels) {
    const label = room.sidebarGroup?.trim() || "Channels";
    channelGroups.set(label, [...(channelGroups.get(label) ?? []), room]);
  }
  const directRooms = rooms.filter((room) => room.roomType === "direct");

  return (
    <nav
      aria-label="Workspace"
      aria-busy={!roomsLoaded}
      className="h-full overflow-y-auto px-2 py-2"
    >
      <div className="mb-3 space-y-0.5">
        <QuickLink
          href="/rooms/soc-operations"
          label="Home"
          icon={House}
          onNavigate={onNavigate}
        />
        <QuickLink
          href="/tasks"
          label="Tasks"
          icon={ListTodo}
          {...(demoMode ? { badge: "4" } : {})}
          onNavigate={onNavigate}
        />
        <QuickLink
          href="/search"
          label="Mentions"
          icon={Bell}
          {...(demoMode ? { badge: "12" } : {})}
          onNavigate={onNavigate}
        />
        <QuickLink
          href="/rooms"
          label="Browse rooms"
          icon={Hash}
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
          className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Search className="size-3.5" />
          <span className="flex-1">Search</span>
          <kbd className="rounded border px-1 text-xs">⌘K</kbd>
        </button>
      </div>

      {roomsLoaded && (
        <>
          <NavGroup label="Starred">
            {favourites.map((room) => (
              <ChannelLink
                key={room.slug}
                room={room}
                onNavigate={onNavigate}
              />
            ))}
          </NavGroup>
          {[...channelGroups.entries()].map(([label, groupedRooms]) => (
            <NavGroup key={label} label={label}>
              {groupedRooms.map((room) => (
                <ChannelLink
                  key={room.slug}
                  room={room}
                  onNavigate={onNavigate}
                />
              ))}
            </NavGroup>
          ))}
          <NavGroup label="Direct messages">
            {directRooms.map((room) => (
              <DirectLink key={room.slug} room={room} onNavigate={onNavigate} />
            ))}
          </NavGroup>
        </>
      )}
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
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
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
          <Button
            variant="ghost"
            size="icon"
            aria-label="Go back"
            onClick={() => router.back()}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Go forward"
            onClick={() => router.forward()}
          >
            <ChevronRight />
          </Button>
        </div>
        <button
          type="button"
          onClick={openPalette}
          className="mx-auto flex h-8 min-w-0 max-w-xl flex-1 items-center gap-2 rounded-md border bg-muted/70 px-3 text-left text-xs text-muted-foreground hover:border-[var(--color-rule-strong)]"
        >
          <Search className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">
            Search {demoOrganisation.name}
          </span>
          <kbd className="hidden rounded border bg-background px-1.5 py-0.5 text-xs tablet:inline">
            ⌘K
          </kbd>
        </button>
        <div className="relative flex items-center gap-1">
          <span className="hidden items-center gap-1.5 text-xs text-[var(--color-success)] wide:flex">
            <span className="size-1.5 rounded-full bg-[var(--color-success)]" />
            Connected
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Pending approvals"
            onClick={() => router.push("/approvals")}
          >
            <CircleCheck />
            <span className="sr-only">
              {demoMode ? "2 pending approvals" : "No pending approvals"}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Notifications (coming soon)"
            title="Notifications are not available yet"
            disabled
          >
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
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
            onClick={() => setUserMenuOpen((current) => !current)}
          >
            <Avatar initials={demoMode ? "JB" : "MA"} />
          </button>
          {userMenuOpen && (
            <div
              role="menu"
              aria-label="User menu"
              className="absolute right-0 top-10 z-50 w-44 rounded-md border bg-background p-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-muted"
                onClick={() => {
                  setTheme(theme === "dark" ? "light" : "dark");
                  setUserMenuOpen(false);
                }}
              >
                {theme === "dark" ? (
                  <Sun className="size-4" />
                ) : (
                  <Moon className="size-4" />
                )}
                {theme === "dark" ? "Use light theme" : "Use dark theme"}
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-muted"
                onClick={async () => {
                  await authClient.signOut();
                  window.location.assign("/login");
                }}
              >
                <LogOut className="size-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <aside className="navigation-sidebar hidden min-h-0 border-r bg-[var(--color-paper-2)] desktop:flex desktop:flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Image
            src="/icons/muster-32.png"
            alt=""
            width={30}
            height={30}
            className="rounded-md"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold">Muster</p>
            <p className="truncate text-xs text-muted-foreground">
              {demoOrganisation.name}
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
          <Avatar initials={demoMode ? "JB" : "MA"} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">
              {demoMode ? "Jordan Blake" : "Muster Administrator"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {demoMode ? "Security Lead" : "Administrator"}
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
