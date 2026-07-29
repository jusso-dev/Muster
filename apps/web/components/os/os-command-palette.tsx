"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Bot,
  Cable,
  CircleCheck,
  ClipboardList,
  Crosshair,
  Puzzle,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const commands = [
  { label: "Go to Command", href: "/", icon: Crosshair, hint: "Nav" },
  { label: "Go to Operations", href: "/operations", icon: ClipboardList, hint: "Nav" },
  { label: "Go to Missions", href: "/missions", icon: Activity, hint: "Nav" },
  { label: "Go to Teams", href: "/teams", icon: Users, hint: "Nav" },
  { label: "Go to Agents", href: "/agents", icon: Bot, hint: "Nav" },
  { label: "Go to Capabilities", href: "/capabilities", icon: Puzzle, hint: "Nav" },
  { label: "Go to Approvals", href: "/approvals", icon: CircleCheck, hint: "Nav" },
  { label: "Go to Audit", href: "/audit", icon: ShieldCheck, hint: "Nav" },
  { label: "Go to Integrations", href: "/integrations", icon: Cable, hint: "Nav" },
  { label: "Go to Settings", href: "/settings", icon: Settings, hint: "Nav" },
] as const;

export function OsCommandPalette({
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

  const filtered = useMemo(
    () =>
      commands.filter((command) =>
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
      className="m-auto w-[min(36rem,calc(100%-2rem))] rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-2xl backdrop:bg-[var(--color-overlay)]"
    >
      <div className="border-b border-border p-3">
        <label className="sr-only" htmlFor="os-command-input">
          Search commands
        </label>
        <input
          id="os-command-input"
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelectedIndex((index) =>
                Math.min(index + 1, Math.max(filtered.length - 1, 0)),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelectedIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const command = filtered[selectedIndex];
              if (command) choose(command.href);
            } else if (event.key === "Escape") {
              onOpenChange(false);
            }
          }}
          placeholder="Navigate Muster…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          autoComplete="off"
        />
      </div>
      <ul className="max-h-80 overflow-y-auto p-1" role="listbox">
        {filtered.map((command, index) => {
          const Icon = command.icon;
          return (
            <li key={command.href} role="option" aria-selected={index === selectedIndex}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
                  index === selectedIndex
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => choose(command.href)}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                <span className="text-xs text-muted-foreground">
                  {command.hint}
                </span>
              </button>
            </li>
          );
        })}
        {filtered.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">
            No matching commands.
          </li>
        ) : null}
      </ul>
      <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        Navigation only. Actions stay capability-checked on the server.
      </p>
    </dialog>
  );
}
