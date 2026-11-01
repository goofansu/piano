/**
 * What the composer's controls do for one moment of a session: whether the primary button sends,
 * queues or stops, whether it is enabled, what it says, what Esc does and how a send-key press is
 * delivered, down to the wire command each one sends. The Enter guard and the button read the same
 * `enabled`, so they cannot disagree. The New page's first message has its situation and command
 * here too. Pure and React-free; the composers render from it.
 */
import type { ClientCommand, ModelCatalog, QueuedMessage, StartOptions } from "@shared/wire";
import { type DraftMessage, hasContent, type ImageDraft, sendable } from "./messageDraft.ts";

/** How a message sent while Pi works is delivered. */
export type DeliveryMode = QueuedMessage["kind"];

/** Pi's own editor steers on Enter, so steering is the default. */
export const DELIVERY: Record<DeliveryMode, { label: string; detail: string }> = {
  steering: { label: "steer", detail: "Adjust the current task." },
  "follow-up": { label: "follow-up", detail: "Add work after the current task." },
};
export const DELIVERY_MODES: readonly DeliveryMode[] = ["steering", "follow-up"];
/** The mode Alt+Enter uses: always the one not chosen. */
export const otherMode = (mode: DeliveryMode): DeliveryMode =>
  mode === "steering" ? "follow-up" : "steering";

/** The session action that delivers a message of this kind. */
const deliveryAction = (kind: DeliveryMode): "steer" | "prompt" =>
  kind === "steering" ? "steer" : "prompt";

/** Stops Pi: the Stop button, and Esc when nothing is queued. */
export const STOP: ClientCommand = { _tag: "act", action: { _tag: "stop" } };
/** Moves queued messages back to the draft without stopping Pi: Edit, and Esc first. */
export const RESTORE_QUEUE: ClientCommand = { _tag: "act", action: { _tag: "restore_queue" } };

/** Delivers `message` as `kind` (from `delivery`), carrying the picker's start options. */
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
  /** The session cannot take input (loading, starting). */
  disabled: boolean;
  /** Pi is working. */
  streaming: boolean;
  compacting: boolean;
  stopping: boolean;
  queued: number;
  /** The sticky delivery preference. */
  mode: DeliveryMode;
}

/** A tooltip reads `lead`, then the key, then `tail`. */
export interface ControlHint {
  lead: string;
  key: "Enter" | "Esc";
  tail?: string;
}

export interface ComposerControl {
  primary: "send" | "queue" | "stop";
  /** Whether the primary action can run now; the button and the send key both obey it. */
  enabled: boolean;
  label: string;
  hint: ControlHint;
  /** The delivery picker is offered: Pi works and is not compacting. */
  showDelivery: boolean;
  /** What Esc sends, nearest thing first: the queue returns to the draft, then Pi stops. */
  escape: ClientCommand | null;
  /** Queued messages can be moved back to the draft. */
  canRestoreQueue: boolean;
  /** How a send-key press is delivered, or null when it sends nothing. */
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
              lead: "Stop and move queued input to the draft.",
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
  const enabled = idle && sendable(draft);
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
    // Nothing can steer a compaction; whatever is sent then waits for it to finish.
    delivery: (alt) =>
      !enabled ? null : s.compacting ? "follow-up" : alt ? otherMode(s.mode) : s.mode,
  };
}

const escapeAction = (s: ComposerSituation, idle: boolean): ComposerControl["escape"] =>
  !idle ? null : s.queued > 0 ? RESTORE_QUEUE : s.streaming ? STOP : null;

/** The queued-messages panel above the draft. */
export interface QueuePanel {
  /** Whether Pi works through the queue or it waits paused, with the count. */
  heading: string;
  editLabel: string;
  editAriaLabel: string;
  /** Each message's kind is shown only when a steer is among them. */
  showKinds: boolean;
}

/** The panel for `queued`, or null when nothing is queued. */
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

/** What the New page knows when its first message would create a session. */
export interface NewSessionSituation {
  text: string;
  images: Pick<ImageDraft, "items" | "busy">;
  connected: boolean;
  /** The directory's catalog: `null` until Pi answers, with `error` when it could not. */
  catalog: Pick<ModelCatalog, "error"> | null;
  cwd: string;
  model: string | undefined;
}

/** The first message can create a session; the button and the send key both obey it. */
export const newSessionReady = (s: NewSessionSituation): boolean =>
  s.connected &&
  !!s.catalog &&
  !s.catalog.error &&
  s.cwd.trim().length > 0 &&
  !!s.model &&
  sendable({ text: s.text, images: s.images });

/** Creates the session in `cwd`, joining `projectId`, with the first message. */
export const newSessionCommand = (
  target: { cwd: string; projectId: string | undefined },
  message: DraftMessage,
  options: StartOptions,
): ClientCommand => ({
  _tag: "create_session",
  cwd: target.cwd.trim(),
  projectId: target.projectId,
  options,
  text: message.text,
  attachments: message.attachments,
});
