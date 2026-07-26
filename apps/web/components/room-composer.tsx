"use client";

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
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
  X,
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

type AttachmentUpload = {
  clientId: string;
  id?: string;
  label: string;
  mimeType: string;
  size: number;
  progress: number;
  state: "uploading" | "stored" | "failed";
  error?: string | undefined;
  file?: File | undefined;
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
  const [uploads, setUploads] = useState<AttachmentUpload[]>([]);
  const [enterToSend, setEnterToSend] = useState(true);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const stateRef = useRef(state);
  const uploadsRef = useRef<AttachmentUpload[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idempotencyKeyRef = useRef(browserUuid());
  const lastSubmittedRef = useRef<SendPayload | null>(null);
  const typingStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingAtRef = useRef(0);
  const storageKey = `muster:draft:${roomSlug}`;
  const enterToSendKey = "muster:composer:enter-send";
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

  function persistDraft(document: Record<string, unknown>) {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        document,
        idempotencyKey: idempotencyKeyRef.current,
        attachments: uploadsRef.current
          .filter(
            (
              upload,
            ): upload is AttachmentUpload & {
              id: string;
              state: "stored";
            } => upload.state === "stored" && Boolean(upload.id),
          )
          .map(({ id, label, mimeType, size }) => ({
            id,
            label,
            mimeType,
            size,
          })),
      }),
    );
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          HTMLAttributes: {
            rel: "noopener noreferrer nofollow",
            target: "_blank",
          },
        },
      }),
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
      persistDraft(current.getJSON());
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
    setEnterToSend(localStorage.getItem(enterToSendKey) !== "false");
  }, []);

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
        attachments?: Array<{
          id: string;
          label: string;
          mimeType: string;
          size: number;
        }>;
        type?: string;
      };
      if (parsed.document) {
        editor.commands.setContent(parsed.document);
        if (parsed.idempotencyKey) {
          idempotencyKeyRef.current = parsed.idempotencyKey;
        }
        const restored = (parsed.attachments ?? []).map((attachment) => ({
          ...attachment,
          clientId: `stored:${attachment.id}`,
          progress: 100,
          state: "stored" as const,
        }));
        uploadsRef.current = restored;
        setUploads(restored);
      } else if (parsed.type === "doc") {
        editor.commands.setContent(parsed);
      }
    } catch {
      localStorage.removeItem(storageKey);
    } finally {
      setEditorReady(true);
    }
  }, [editor, storageKey]);

  useEffect(() => {
    uploadsRef.current = uploads;
    if (!editor || !editorReady || (editor.isEmpty && uploads.length === 0))
      return;
    persistDraft(editor.getJSON());
  }, [editor, editorReady, uploads, storageKey]);

  useEffect(
    () => () => {
      if (typingStopRef.current) clearTimeout(typingStopRef.current);
      reportTyping(false);
    },
    [roomId],
  );

  async function send(retry = false) {
    if (!editor || stateRef.current === "sending" || !roomId) return;
    const storedAttachments = uploadsRef.current.filter(
      (upload): upload is AttachmentUpload & { id: string; state: "stored" } =>
        upload.state === "stored" && Boolean(upload.id),
    );
    const payload =
      retry && lastSubmittedRef.current
        ? lastSubmittedRef.current
        : (() => {
            const editorDocument = editor.getJSON();
            const attachmentText = storedAttachments.map(
              (attachment) => `Evidence attachment: ${attachment.label}`,
            );
            return {
              document: {
                ...editorDocument,
                content: [
                  ...(Array.isArray(editorDocument.content)
                    ? editorDocument.content
                    : []),
                  ...storedAttachments.map((attachment) => ({
                    type: "attachment",
                    attrs: { id: attachment.id, label: attachment.label },
                  })),
                ],
              },
              plainText: [editor.getText().trim(), ...attachmentText]
                .filter(Boolean)
                .join("\n"),
              messageType: "text" as const,
              dataClassification: "internal" as const,
              idempotencyKey: idempotencyKeyRef.current,
            };
          })();
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
      uploadsRef.current = [];
      setUploads([]);
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
      !enterToSend ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      window.matchMedia("(pointer: coarse)").matches
    ) {
      return;
    }
    event.preventDefault();
    void send();
  }

  function applyLink() {
    if (!editor) return;
    const raw = linkUrl.trim();
    if (!raw) return;
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    let href: string;
    try {
      const parsed = new URL(candidate);
      if (!["http:", "https:"].includes(parsed.protocol)) return;
      href = parsed.toString();
    } catch {
      return;
    }
    if (editor.state.selection.empty) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: href,
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setLinkOpen(false);
    setLinkUrl("");
  }

  function updateUpload(clientId: string, changes: Partial<AttachmentUpload>) {
    setUploads((current) =>
      current.map((upload) =>
        upload.clientId === clientId ? { ...upload, ...changes } : upload,
      ),
    );
  }

  function uploadFile(file: File, existingClientId?: string) {
    if (!roomId) return;
    const clientId = existingClientId ?? browserUuid();
    if (!existingClientId) {
      if (uploadsRef.current.length >= 10) return;
      setUploads((current) => [
        ...current,
        {
          clientId,
          label: file.name,
          mimeType: file.type,
          size: file.size,
          progress: 0,
          state: "uploading",
          file,
        },
      ]);
    } else {
      updateUpload(clientId, {
        progress: 0,
        state: "uploading",
        error: undefined,
      });
    }
    const form = new FormData();
    form.set("file", file);
    form.set("classification", "internal");
    const request = new XMLHttpRequest();
    request.open("POST", `/api/v1/rooms/${roomId}/attachments`);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        updateUpload(clientId, {
          progress: Math.round((event.loaded / event.total) * 100),
        });
      }
    });
    request.addEventListener("load", () => {
      const response = (() => {
        try {
          return JSON.parse(request.responseText) as {
            data?: {
              id?: string;
              label?: string;
              mimeType?: string;
              size?: number;
            };
            detail?: string;
          };
        } catch {
          return null;
        }
      })();
      if (request.status >= 200 && request.status < 300 && response?.data?.id) {
        updateUpload(clientId, {
          id: response.data.id,
          label: response.data.label ?? file.name,
          mimeType: response.data.mimeType ?? file.type,
          size: response.data.size ?? file.size,
          progress: 100,
          state: "stored",
          error: undefined,
          file: undefined,
        });
        return;
      }
      updateUpload(clientId, {
        state: "failed",
        error: response?.detail ?? `Upload failed (${request.status})`,
      });
    });
    request.addEventListener("error", () => {
      updateUpload(clientId, {
        state: "failed",
        error: "Upload failed. Retry is safe.",
      });
    });
    request.send(form);
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    files.forEach((file) => uploadFile(file));
  }

  return (
    <div className="border-t bg-background p-2">
      <div className="mx-auto max-w-5xl rounded-lg border bg-card shadow-sm focus-within:border-[var(--color-focus)]">
        <EditorContent
          editor={editor}
          className="px-3 py-1.5 text-sm"
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        {uploads.length > 0 && (
          <div
            className="space-y-1 border-t px-3 py-2"
            aria-label="Evidence attachments"
          >
            {uploads.map((upload) => (
              <div
                key={upload.clientId}
                className="flex items-center gap-2 text-xs"
              >
                <FileUp className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{upload.label}</span>
                {upload.state === "uploading" && (
                  <>
                    <progress
                      className="h-1.5 w-24"
                      max={100}
                      value={upload.progress}
                      aria-label={`Uploading ${upload.label}`}
                    />
                    <span>{upload.progress}%</span>
                  </>
                )}
                {upload.state === "stored" && (
                  <span className="text-[var(--color-success)]">
                    Stored · pending scan
                  </span>
                )}
                {upload.state === "failed" && (
                  <>
                    <span role="alert" className="text-[var(--color-error)]">
                      {upload.error}
                    </span>
                    {upload.file && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          uploadFile(upload.file!, upload.clientId)
                        }
                      >
                        Retry upload
                      </Button>
                    )}
                  </>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 min-h-7"
                  aria-label={`Remove ${upload.label}`}
                  onClick={() =>
                    setUploads((current) =>
                      current.filter(
                        (candidate) => candidate.clientId !== upload.clientId,
                      ),
                    )
                  }
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
        )}
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
              aria-label="Attach evidence"
              title="Upload governed evidence to this room"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp />
            </Button>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              multiple
              accept=".json,.pdf,.zip,.txt,.csv,.png,.jpg,.jpeg"
              aria-label="Choose evidence files"
              onChange={(event) => {
                Array.from(event.target.files ?? []).forEach((file) =>
                  uploadFile(file),
                );
                event.target.value = "";
              }}
            />
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
              aria-label="Add link"
              aria-expanded={linkOpen}
              title="Add a safe HTTP or HTTPS link"
              onClick={() => setLinkOpen((current) => !current)}
            >
              <Link2 />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Link security reference"
              title="Insert an authorised Muster reference"
              onClick={() =>
                editor?.chain().focus().insertContent("/reference ").run()
              }
            >
              Reference
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
          {linkOpen && (
            <div className="flex w-full items-center gap-2 border-t px-1 pt-2">
              <label className="sr-only" htmlFor="room-composer-link">
                Link URL
              </label>
              <input
                id="room-composer-link"
                className="h-9 min-w-48 flex-1 rounded border bg-background px-2 text-xs"
                type="url"
                inputMode="url"
                placeholder="https://example.test/reference"
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyLink();
                  }
                }}
              />
              <Button size="sm" variant="outline" onClick={applyLink}>
                Apply link
              </Button>
              {editor?.isActive("link") && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => editor.chain().focus().unsetLink().run()}
                >
                  Remove link
                </Button>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="hidden items-center gap-1.5 text-xs text-muted-foreground tablet:flex">
              <input
                type="checkbox"
                className="size-6 shrink-0"
                checked={enterToSend}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setEnterToSend(enabled);
                  localStorage.setItem(enterToSendKey, String(enabled));
                }}
              />
              Enter sends
            </label>
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
                state === "sending" ||
                !editorReady ||
                !editor ||
                uploads.some((upload) => upload.state === "uploading") ||
                (editor.isEmpty &&
                  !uploads.some((upload) => upload.state === "stored"))
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
