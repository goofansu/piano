import type { ClientCommand, ModelCatalog, QueuedMessage, StartOptions } from "@shared/wire";
import { type DraftMessage, hasContent, type ImageDraft, sendable } from "./messageDraft.ts";

export type DeliveryMode = QueuedMessage["kind"];

export const DELIVERY: Record<DeliveryMode, { label: string; detail: string }> = {
  steering: { label: "steer", detail: "Adjust the current task." },
  "follow-up": { label: "follow-up", detail: "Add work after the current task." },
};
export const DELIVERY_MODES: readonly DeliveryMode[] = ["steering", "follow-up"];
export const otherMode = (mode: DeliveryMode): DeliveryMode =>
  mode === "steering" ? "follow-up" : "steering";

const deliveryAction = (kind: DeliveryMode): "steer" | "prompt" =>
  kind === "steering" ? "steer" : "prompt";

export const STOP: ClientCommand = { _tag: "act", action: { _tag: "stop" } };
export const RESTORE_QUEUE: ClientCommand = { _tag: "act", action: { _tag: "restore_queue" } };
export const QUEUE_RESTORE_HINT =
  "Move queued text back to the draft without stopping Pi. Pi returns text only, so reattach any images.";
export const QUEUE_RESTORED_NOTICE = "Queued text moved to the draft; reattach any images";

export const messageCommand = (
  kind: DeliveryMode,
  message: DraftMessage,
  start: StartOptions,
  inputId?: string,
): ClientCommand => ({
  _tag: "act",
  action: {
    _tag: deliveryAction(kind),
    text: message.text,
    attachments: message.attachments,
    ...(inputId === undefined ? {} : { inputId }),
  },
  start,
});

export interface ComposerSituation {
  text: string;
  images: Pick<ImageDraft, "items" | "busy">;
  disabled: boolean;
  streaming: boolean;
  compacting: boolean;
  stopping: boolean;
  preparing?: boolean;
  queued: number;
  mode: DeliveryMode;
}

export interface ControlHint {
  lead: string;
  key: "Enter" | "Esc";
  tail?: string;
}

export interface ComposerControl {
  primary: "send" | "queue" | "stop";
  enabled: boolean;
  label: string;
  hint: ControlHint;
  showDelivery: boolean;
  escape: ClientCommand | null;
  canRestoreQueue: boolean;
  delivery: (alt: boolean) => DeliveryMode | null;
}

export function composerControl(s: ComposerSituation): ComposerControl {
  const draft = { text: s.text, images: s.images };
  const showDelivery = s.streaming && !s.compacting;
  const idle = !s.disabled && !s.stopping;
  if (s.streaming && !hasContent(draft)) {
    return {
      primary: "stop",
      enabled: idle,
      label: "Stop",
      hint:
        s.queued > 0
          ? {
              lead: "Stop and move queued text to the draft. Reattach any images.",
              key: "Esc",
              tail: " edits without stopping.",
            }
          : { lead: "Stop", key: "Esc" },
      showDelivery,
      escape: escapeAction(s, idle),
      canRestoreQueue: idle,
      delivery: () => null,
    };
  }
  const enabled = idle && !s.preparing && sendable(draft);
  return {
    primary: s.streaming ? "queue" : "send",
    enabled,
    label: showDelivery ? DELIVERY[s.mode].label : s.streaming ? "Queue message" : "Send",
    hint: {
      lead: showDelivery
        ? `${DELIVERY[s.mode].label}: ${DELIVERY[s.mode].detail}`
        : s.streaming
          ? "Send after compaction finishes"
          : "Send",
      key: "Enter",
    },
    showDelivery,
    escape: escapeAction(s, idle),
    canRestoreQueue: idle,
    delivery: (alt) =>
      !enabled ? null : s.compacting ? "follow-up" : alt ? otherMode(s.mode) : s.mode,
  };
}

const escapeAction = (s: ComposerSituation, idle: boolean): ComposerControl["escape"] =>
  !idle ? null : s.queued > 0 ? RESTORE_QUEUE : s.streaming ? STOP : null;

export interface QueuePanel {
  heading: string;
  editLabel: string;
  editAriaLabel: string;
  showKinds: boolean;
}

export function queuePanel(
  queued: readonly Pick<QueuedMessage, "kind">[],
  streaming: boolean,
): QueuePanel | null {
  if (queued.length === 0) return null;
  const one = queued.length === 1;
  return {
    heading: `${streaming ? "Queued messages" : "Paused queue"} (${queued.length})`,
    editLabel: one ? "Edit" : "Edit all",
    editAriaLabel: one ? "Edit queued message" : "Edit all queued messages",
    showKinds: queued.some((message) => message.kind === "steering"),
  };
}

export interface NewSessionSituation {
  text: string;
  images: Pick<ImageDraft, "items" | "busy">;
  connected: boolean;
  catalog: Pick<ModelCatalog, "error"> | null;
  cwd: string;
  model: string | undefined;
}

export const newSessionReady = (s: NewSessionSituation): boolean =>
  s.connected &&
  !!s.catalog &&
  !s.catalog.error &&
  s.cwd.trim().length > 0 &&
  !!s.model &&
  sendable({ text: s.text, images: s.images });

export const newSessionCommand = (
  target: { cwd: string; projectId: string | undefined },
  message: DraftMessage,
  options: StartOptions,
): Extract<ClientCommand, { _tag: "create_session" }> => ({
  _tag: "create_session",
  cwd: target.cwd.trim(),
  projectId: target.projectId,
  options,
  text: message.text,
  attachments: message.attachments,
});
