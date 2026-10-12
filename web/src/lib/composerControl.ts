/**
 * What the composer's controls do for one moment of a session: whether the primary button sends,
 * queues or stops, whether it is enabled, what it says, what Esc does and how a send-key press is
 * delivered. The Enter guard and the button read the same `enabled`, so they cannot disagree.
 * Pure and React-free; the composer renders from it.
 */
import type { QueuedMessage } from "@shared/wire";
import { hasContent, type ImageDraft, sendable } from "./messageDraft.ts";

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
export const deliveryAction = (kind: DeliveryMode): "steer" | "prompt" =>
  kind === "steering" ? "steer" : "prompt";

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
  /** Images are attached while Pi works; they can only be sent once it finishes. */
  imagesWaiting: boolean;
  /** Esc acts on the nearest thing first: the queue returns to the draft, then Pi stops. */
  escape: "restore-queue" | "stop" | "none";
  /** Queued messages can be moved back to the draft. */
  canRestoreQueue: boolean;
  /** How a send-key press is delivered, or null when it sends nothing. */
  delivery: (alt: boolean) => DeliveryMode | null;
}

export function composerControl(s: ComposerSituation): ComposerControl {
  const draft = { text: s.text, images: s.images };
  const imagesWaiting = s.streaming && s.images.items.length > 0;
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
      imagesWaiting,
      escape: escapeAction(s, idle),
      canRestoreQueue: idle,
      delivery: () => null,
    };
  }
  const enabled = idle && !imagesWaiting && sendable(draft);
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
    imagesWaiting,
    escape: escapeAction(s, idle),
    canRestoreQueue: idle,
    // Nothing can steer a compaction; whatever is sent then waits for it to finish.
    delivery: (alt) =>
      !enabled ? null : s.compacting ? "follow-up" : alt ? otherMode(s.mode) : s.mode,
  };
}

const escapeAction = (s: ComposerSituation, idle: boolean): ComposerControl["escape"] =>
  !idle ? "none" : s.queued > 0 ? "restore-queue" : s.streaming ? "stop" : "none";
