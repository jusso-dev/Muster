"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Hash,
  ListTodo,
  MessageSquare,
  Moon,
  Search,
  Sun,
} from "lucide-react";
import { demoDirectRooms, demoMode, demoRooms } from "@/lib/demo-data";
import { cn } from "@/lib/utils";

const baseCommands = [
  {
    label: "Search messages and security memory",
    href: "/search",
    icon: Search,
    hint: "S",
  },
  { label: "Open task board", href: "/tasks", icon: ListTodo, hint: "T" },
  ...(demoMode
    ? [
        { label: "Open #alerts", href: "/rooms/alerts", icon: Hash, hint: "A" },
        {
          label: "Open #active-incidents",
          href: "/rooms/active-incidents",
          icon: Hash,
          hint: "I",
        },
      ]
    : []),
] as const;

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      inputRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const commands = useMemo(
    () =>
      [
        ...baseCommands,
        ...demoRooms.map((room) => ({
          label: `# ${room.name}`,
          href: `/rooms/${room.slug}`,
          icon: Hash,
          hint: "Room",
        })),
        ...demoDirectRooms.map((room) => ({
          label: `Message ${room.name}`,
          href: `/rooms/${room.slug}`,
          icon: room.agent ? Bot : MessageSquare,
          hint: room.agent ? "Agent" : "DM",
        })),
      ].filter((command) =>
        command.label.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
  );

  useEffect(() => setSelectedIndex(0), [query]);

  function choose(href: string) {
    onOpenChange(false);
    setQuery("");
    router.push(href);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="Command palette"
      onClose={() => onOpenChange(false)}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current.close();
      }}
      className="m-auto w-[min(42rem,calc(100%-2rem))] rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-2xl backdrop:bg-[var(--color-overlay)]"
    >
      <div className="flex items-center gap-3 border-b px-4">
        <Search className="size-4 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelectedIndex((current) =>
                commands.length === 0
                  ? 0
                  : Math.min(current + 1, commands.length - 1),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelectedIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const command = commands[selectedIndex];
              if (command) choose(command.href);
            } else if (event.key === "Escape") {
              onOpenChange(false);
            }
          }}
          placeholder="Type a command or search rooms"
          className="h-13 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <kbd className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
          Esc
        </kbd>
      </div>
      <div className="max-h-[24rem] overflow-y-auto p-2">
        {commands.map((command, index) => (
          <button
            key={`${command.href}-${command.label}`}
            onClick={() => choose(command.href)}
            className={cn(
              "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm hover:bg-muted",
              index === selectedIndex && "bg-muted",
            )}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <command.icon
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="flex-1">{command.label}</span>
            <span className="text-xs text-muted-foreground">
              {command.hint}
            </span>
          </button>
        ))}
        {commands.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No matching commands.
          </p>
        )}
      </div>
      <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
        <span>Results filtered by your capabilities</span>
        <span className="flex items-center gap-2">
          <Sun className="size-3" /> / <Moon className="size-3" /> theme in
          settings
        </span>
      </div>
    </dialog>
  );
}
