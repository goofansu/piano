import type { ClientCommand, ServerMessage } from "@shared/wire";
import type { Client } from "../client.ts";

export const RECEIPT_TIMEOUT_MS = 75_000;

export interface RequestTimers {
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
}

export const browserTimers: RequestTimers = {
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
};

type ReceiptResult = { status: string };
type ErrorResult<R extends ReceiptResult> = Extract<R, { status: "error" }>;

export type RequestOutcome<R extends ReceiptResult> =
  | { status: "not-sent" }
  | { status: "failed"; error: ErrorResult<R> }
  | { status: "confirmed"; result: Exclude<R, { status: "error" }> }
  | { status: "unconfirmed"; reason: "connection-lost" | "no-receipt" };

export interface CorrelatedRequest<R extends ReceiptResult> {
  command: (requestId: string) => ClientCommand;
  receipt: (message: ServerMessage) => { requestId: string; result: R } | undefined;
  pending: (requestId: string) => void;
  settle: (outcome: RequestOutcome<R>) => void;
}

export interface CorrelatedRequestOptions {
  client: Pick<Client, "getState" | "subscribe" | "send" | "listen">;
  newRequestId?: () => string;
  timers?: RequestTimers;
}

export function correlatedRequests({
  client,
  newRequestId = () => crypto.randomUUID(),
  timers = browserTimers,
}: CorrelatedRequestOptions) {
  return {
    send: <R extends ReceiptResult>({
      command,
      receipt,
      pending,
      settle,
    }: CorrelatedRequest<R>): { requestId: string; cancel: () => void } => {
      const requestId = newRequestId();
      let open = true;
      let timer: unknown;
      let stopState = () => {};
      const close = () => {
        if (!open) return false;
        open = false;
        if (timer !== undefined) timers.clearTimeout(timer);
        timer = undefined;
        stopState();
        stopMessages();
        return true;
      };
      const finish = (outcome: RequestOutcome<R>) => {
        if (close()) settle(outcome);
      };
      const stopMessages = client.listen((message) => {
        const answer = receipt(message);
        if (!answer || answer.requestId !== requestId) return;
        const { result } = answer;
        finish(
          result.status === "error"
            ? { status: "failed", error: result as ErrorResult<R> }
            : { status: "confirmed", result: result as Exclude<R, { status: "error" }> },
        );
      });
      timer = timers.setTimeout(() => {
        finish({ status: "unconfirmed", reason: "no-receipt" });
      }, RECEIPT_TIMEOUT_MS);
      pending(requestId);
      let sent: ReturnType<typeof client.send>;
      try {
        sent = client.send(command(requestId));
      } catch {
        sent = "not-sent";
      }
      if (sent === "not-sent") finish({ status: "not-sent" });
      else if (open) {
        const lost = () => {
          if (!client.getState().connected)
            finish({ status: "unconfirmed", reason: "connection-lost" });
        };
        stopState = client.subscribe(lost);
        lost();
      }
      return { requestId, cancel: close };
    },
  };
}
