import { MAX_MESSAGE_BYTES } from "../shared/attachments.ts";

const MiB = 1024 * 1024;

/** Non-waiting admission: ordinary work cannot occupy the reserved control lane.
 * Rejected input is never queued for later execution. Keep the lease until the
 * admitted work ends, including work whose browser has disconnected. */
export const inboundLimits = {
  frameBytes: MAX_MESSAGE_BYTES,
  rpcLineBytes: MAX_MESSAGE_BYTES,
  records: { messages: 256, bytes: MAX_MESSAGE_BYTES },
  // Room for two maximum-size messages at once in each ordinary lane.
  client: { messages: 8, bytes: 2 * MAX_MESSAGE_BYTES },
  requests: { messages: 32, bytes: 2 * MAX_MESSAGE_BYTES },
  writes: { messages: 32, bytes: 2 * MAX_MESSAGE_BYTES },
  control: { messages: 8, bytes: 32 * MiB },
} as const;

export function makeInboundCapacity(
  ordinary: { messages: number; bytes: number },
  control = inboundLimits.control,
) {
  const lanes = [ordinary, control].map((limits) => ({ limits, messages: 0, bytes: 0 }));
  return {
    /** Returns an idempotent release, or undefined without retaining the input. */
    acquire(bytes: number, priority = false): (() => void) | undefined {
      const lane = lanes[priority ? 1 : 0];
      if (lane.messages >= lane.limits.messages || lane.bytes + bytes > lane.limits.bytes) return;
      lane.messages++;
      lane.bytes += bytes;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        lane.messages--;
        lane.bytes -= bytes;
      };
    },
  };
}
