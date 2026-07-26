"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import {
  AtSign,
  Bold,
  Bot,
  Code2,
  FileUp,
  Italic,
  Link2,
  ListChecks,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { browserUuid } from "@/lib/browser-uuid";
import { roomIdBySlug } from "@/lib/demo-data";

export type RoomMessageRecord = {
  id: string;
  roomId?: string;
  threadParentId: string | null;
  authorActorId: string;
  authorName?: string;
  authorType?: "human" | "agent" | "product" | "service" | "system";
  messageType?: string;
  dataClassification?: string;
  document?: Record<string, unknown>;
  plainText: string;
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  reactions?: Array<{
    emoji: string;
    count: number;
    reactedByMe: boolean;
  }>;
  replyCount?: number;
  participantActorIds?: string[];
  pinned?: boolean;
  saved?: boolean;
  following?: boolean;
  canEdit?: boolean;
  canPin?: boolean;
  unread?: boolean;
  relatedAlertId?: string | null;
  relatedInvestigationId?: string | null;
  relatedCaseId?: string | null;
  relatedAgentRunId?: string | null;
  relatedWorkflowRunId?: string | null;
  clientId?: string;
  idempotencyKey?: string;
  deliveryState?: "pending" | "delivered" | "failed";
};

type SendPayload = {
  document: Record<string, unknown>;
  plainText: string;
  messageType: "text";
  dataClassification: "internal";
  idempotencyKey: string;
};

export function RoomComposer({
  roomSlug,
  roomLabel,
  onDeliveryChange,
}: {
  roomSlug: string;
  roomLabel?: string;
  onDeliveryChange?: (message: RoomMessageRecord) => void;
}) {
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [editorReady, setEditorReady] = useState(false);
  const stateRef = useRef(state);
  const idempotencyKeyRef = useRef(browserUuid());
  const lastSubmittedRef = useRef<SendPayload | null>(null);
  const typingStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingAtRef = useRef(0);
  const storageKey = `muster:draft:${roomSlug}`;
  const roomId =
    roomIdBySlug[roomSlug] ??
    roomIdBySlug["investigation-suspicious-powershell"];

  function updateState(next: "idle" | "sending" | "error") {
    stateRef.current = next;
    setState(next);
  }

  function reportTyping(active: boolean) {
    if (!roomId) return;
    void fetch(`/api/v1/rooms/${roomId}/typing`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active }),
    }).catch(() => undefined);
  }

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
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          document: current.getJSON(),
          idempotencyKey: idempotencyKeyRef.current,
        }),
      );
      const now = Date.now();
      if (now - lastTypingAtRef.current > 1_500) {
        lastTypingAtRef.current = now;
        reportTyping(true);
      }
      if (typingStopRef.current) clearTimeout(typingStopRef.current);
      typingStopRef.current = setTimeout(() => reportTyping(false), 2_500);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const draft = localStorage.getItem(storageKey);
    if (!draft) {
      setEditorReady(true);
      return;
    }
    try {
      const parsed = JSON.parse(draft) as {
        document?: Record<string, unknown>;
        idempotencyKey?: string;
        type?: string;
      };
      if (parsed.document) {
        editor.commands.setContent(parsed.document);
        if (parsed.idempotencyKey) {
          idempotencyKeyRef.current = parsed.idempotencyKey;
        }
      } else if (parsed.type === "doc") {
        editor.commands.setContent(parsed);
      }
    } catch {
      localStorage.removeItem(storageKey);
    } finally {
      setEditorReady(true);
    }
  }, [editor, storageKey]);

  useEffect(
    () => () => {
      if (typingStopRef.current) clearTimeout(typingStopRef.current);
      reportTyping(false);
    },
    [roomId],
  );

  async function send(retry = false) {
    if (!editor || stateRef.current === "sending" || !roomId) return;
    const payload =
      retry && lastSubmittedRef.current
        ? lastSubmittedRef.current
        : {
            document: editor.getJSON(),
            plainText: editor.getText().trim(),
            messageType: "text" as const,
            dataClassification: "internal" as const,
            idempotencyKey: idempotencyKeyRef.current,
          };
    if (!payload.plainText) return;
    lastSubmittedRef.current = payload;
    const clientId = `client:${payload.idempotencyKey}`;
    updateState("sending");
    reportTyping(false);
    onDeliveryChange?.({
      id: clientId,
      clientId,
      threadParentId: null,
      authorActorId: "",
      plainText: payload.plainText,
      createdAt: new Date().toISOString(),
      idempotencyKey: payload.idempotencyKey,
      deliveryState: "pending",
    });
    try {
      const response = await fetch(`/api/v1/rooms/${roomId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok)
        throw new Error(`Message send failed (${response.status})`);
      const result = (await response.json()) as { data: RoomMessageRecord };
      onDeliveryChange?.({
        ...result.data,
        clientId,
        idempotencyKey: payload.idempotencyKey,
        deliveryState: "delivered",
      });
      editor.commands.clearContent();
      localStorage.removeItem(storageKey);
      idempotencyKeyRef.current = browserUuid();
      lastSubmittedRef.current = null;
      updateState("idle");
    } catch {
      updateState("error");
      onDeliveryChange?.({
        id: clientId,
        clientId,
        threadParentId: null,
        authorActorId: "",
        plainText: payload.plainText,
        createdAt: new Date().toISOString(),
        idempotencyKey: payload.idempotencyKey,
        deliveryState: "failed",
      });
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      window.matchMedia("(pointer: coarse)").matches
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
              aria-label="Bold"
              aria-pressed={editor?.isActive("bold") ?? false}
              onClick={() => editor?.chain().focus().toggleBold().run()}
            >
              <Bold />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Italic"
              aria-pressed={editor?.isActive("italic") ?? false}
              onClick={() => editor?.chain().focus().toggleItalic().run()}
            >
              <Italic />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Inline code"
              aria-pressed={editor?.isActive("code") ?? false}
              onClick={() => editor?.chain().focus().toggleCode().run()}
            >
              <Code2 />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Attach evidence (policy check required)"
              title="Evidence uploads require a governed evidence record"
              disabled
            >
              <FileUp />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Mention a person or agent"
              title="Type @name in the composer"
              onClick={() => editor?.chain().focus().insertContent("@").run()}
            >
              <AtSign />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Mention agent"
              title="Type an agent name after @"
              onClick={() => editor?.chain().focus().insertContent("@").run()}
            >
              <Bot />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Link security reference"
              title="Paste an authorised Muster reference"
              onClick={() =>
                editor?.chain().focus().insertContent("/reference ").run()
              }
            >
              <Link2 />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Record decision"
              title="Insert the decision slash command"
              onClick={() =>
                editor?.chain().focus().insertContent("/decision ").run()
              }
            >
              <ShieldCheck />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Start workflow"
              title="Insert the workflow slash command"
              onClick={() =>
                editor?.chain().focus().insertContent("/workflow ").run()
              }
            >
              <ListChecks />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground tablet:inline">
              Enter to send · Shift+Enter for new line
            </span>
            <span className="sr-only" aria-live="polite">
              {state === "sending"
                ? "Sending message"
                : state === "error"
                  ? "Message failed. Draft preserved."
                  : "Composer ready"}
            </span>
            {state === "error" && (
              <>
                <span
                  role="alert"
                  className="text-xs text-[var(--color-error)]"
                >
                  Message failed. Draft preserved.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void send(true)}
                >
                  <RefreshCw /> Retry
                </Button>
              </>
            )}
            <Button
              onClick={() => void send()}
              autoComplete="off"
              disabled={
                state === "sending" || !editorReady || !editor || editor.isEmpty
              }
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
