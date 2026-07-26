"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  AtSign,
  Bot,
  FileUp,
  Link2,
  ListChecks,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { roomIdBySlug } from "@/lib/demo-data";
import { browserUuid } from "@/lib/browser-uuid";

export type RoomMessageRecord = {
  id: string;
  threadParentId: string | null;
  authorActorId: string;
  plainText: string;
  createdAt: string;
};

export function RoomComposer({
  roomSlug,
  roomLabel,
  onSent,
}: {
  roomSlug: string;
  roomLabel?: string;
  onSent?: (message: RoomMessageRecord) => void;
}) {
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const storageKey = `muster:draft:${roomSlug}`;
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: `Message ${roomLabel ?? `#${roomSlug}`} or type / for commands`,
      }),
    ],
    editorProps: {
      attributes: {
        "aria-label": `Message ${roomLabel ?? `#${roomSlug}`}`,
        "aria-multiline": "true",
        role: "textbox",
      },
    },
    immediatelyRender: false,
    onUpdate({ editor: current }) {
      localStorage.setItem(storageKey, JSON.stringify(current.getJSON()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    const draft = localStorage.getItem(storageKey);
    if (!draft) return;
    try {
      editor.commands.setContent(JSON.parse(draft));
    } catch {
      localStorage.removeItem(storageKey);
    }
  }, [editor, storageKey]);

  async function send() {
    if (!editor || editor.isEmpty || state === "sending") return;
    const roomId =
      roomIdBySlug[roomSlug] ??
      roomIdBySlug["investigation-suspicious-powershell"];
    if (!roomId) return;
    setState("sending");
    try {
      const response = await fetch(`/api/v1/rooms/${roomId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          document: editor.getJSON(),
          plainText: editor.getText(),
          messageType: "text",
          dataClassification: "internal",
          idempotencyKey: browserUuid(),
        }),
      });
      if (!response.ok) {
        setState("error");
        return;
      }
      const payload = (await response.json()) as { data: RoomMessageRecord };
      editor.commands.clearContent();
      localStorage.removeItem(storageKey);
      setState("idle");
      onSent?.(payload.data);
    } catch {
      setState("error");
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    void send();
  }

  return (
    <div className="border-t bg-background p-2">
      <div className="mx-auto max-w-5xl rounded-lg border bg-card shadow-sm focus-within:border-[var(--color-focus)]">
        <EditorContent
          editor={editor}
          className="px-3 py-1.5 text-sm"
          onKeyDown={handleKeyDown}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-2 py-1.5">
          <div className="flex items-center">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Attach evidence (coming soon)"
              title="Evidence attachments are not available yet"
              disabled
            >
              <FileUp />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Mention person (coming soon)"
              title="Person mentions are not available yet"
              disabled
            >
              <AtSign />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Mention agent (coming soon)"
              title="Agent mentions are not available yet"
              disabled
            >
              <Bot />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Link alert (coming soon)"
              title="Alert linking is not available yet"
              disabled
            >
              <Link2 />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Record decision (coming soon)"
              title="Decision recording is not available yet"
              disabled
            >
              <ShieldCheck />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Start workflow (coming soon)"
              title="Workflow starts are not available yet"
              disabled
            >
              <ListChecks />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground tablet:inline">
              Enter to send · Shift+Enter for new line
            </span>
            {state === "error" && (
              <span role="alert" className="text-xs text-[var(--color-error)]">
                Message failed. Draft preserved.
              </span>
            )}
            <Button
              onClick={() => void send()}
              disabled={state === "sending"}
              state={
                state === "sending"
                  ? "loading"
                  : state === "error"
                    ? "error"
                    : "default"
              }
            >
              {state === "sending" ? "Sending…" : "Send"} <Send />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
