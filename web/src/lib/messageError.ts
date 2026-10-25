import type { RenderMsg, ToolExecution } from "@shared/wire";
import { cutText } from "../../../shared/cutText.ts";

export interface MessageError {
  summary: string;
  details?: string;
}

/** Presentation only: never rewrite Pi history or infer cancellation from a failed tool alone. */
export function messageError(
  msg: RenderMsg,
  preceding: readonly RenderMsg[],
  results: ReadonlyMap<string, RenderMsg>,
  tools: Readonly<Record<string, ToolExecution>>,
): MessageError | undefined {
  const raw = msg.errorMessage;
  if (!raw) return undefined;
  if (
    /^(?:This operation was aborted|The operation was aborted|Operation aborted|Request aborted|Aborted)\.?$/i.test(
      raw.trim(),
    )
  ) {
    // Pi can attach the abort to the call message or emit a separate assistant message
    // after its results. Never look across another assistant reply or a user turn.
    const previous = preceding.findLast((m) => m.role === "assistant" || m.role === "user");
    const calls = msg.toolCalls?.length
      ? msg.toolCalls
      : previous?.role === "assistant"
        ? previous.toolCalls
        : undefined;
    const represented = calls?.some((call) => {
      const result = results.get(call.id);
      const execution = tools[call.id];
      const failed = result?.isError || execution?.status === "error";
      const output = result?.text ?? execution?.text ?? "";
      return (
        failed && execution?.status !== "running" && /(?:^|\n)Command aborted\.?\s*$/i.test(output)
      );
    });
    if (represented) return undefined;
  }

  let summary = raw.trim();
  const api = summary.match(/^.+? API error \(\d+\):\s*([\s\S]+)$/);
  if (api) {
    try {
      const payload = JSON.parse(api[1]) as {
        message?: unknown;
        error?: { message?: unknown };
      } | null;
      const message = payload?.message ?? payload?.error?.message;
      if (typeof message === "string" && message.trim()) summary = message.trim();
    } catch {
      // Unknown or partial provider payloads stay readable, with the original on demand.
    }
  }
  if (summary.length > 240) summary = `${cutText(summary, 237)}…`;
  return { summary, ...(summary !== raw ? { details: raw } : {}) };
}
