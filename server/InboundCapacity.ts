/** Non-waiting admission: ordinary work cannot occupy the reserved control lane.
 * Rejected input is never queued for later execution. Keep the lease until the
 * admitted work ends, including work whose browser has disconnected. */
export const inboundLimits = {
  // Allows the existing 20 MiB image batch after base64 encoding, plus JSON/text.
  frameBytes: 32 * 1024 * 1024,
  rpcLineBytes: 32 * 1024 * 1024,
  records: { messages: 256, bytes: 32 * 1024 * 1024 },
  client: { messages: 8, bytes: 64 * 1024 * 1024 },
  requests: { messages: 32, bytes: 64 * 1024 * 1024 },
  writes: { messages: 32, bytes: 64 * 1024 * 1024 },
  control: { messages: 8, bytes: 32 * 1024 * 1024 },
} as const;

export function makeInboundCapacity(ordinary: { messages: number; bytes: number }, control = inboundLimits.control) {
  const lanes = [ordinary, control].map(limits => ({ limits, messages: 0, bytes: 0 }));
  return {
    /** Returns an idempotent release, or undefined without retaining the input. */
    acquire(bytes: number, priority = false): (() => void) | undefined {
      const lane = lanes[priority ? 1 : 0];
      if (lane.messages >= lane.limits.messages || lane.bytes + bytes > lane.limits.bytes) return;
      lane.messages++; lane.bytes += bytes;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        lane.messages--; lane.bytes -= bytes;
      };
    },
  };
}
