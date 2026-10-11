/**
 * The text a person sees for a failure: the error's own `detail`, which Piano's errors write for
 * people. Without one, `fallback` when the caller has a better sentence, else what the error says
 * about itself.
 */
export const errorText = (error: unknown, fallback?: string): string => {
  const o = error && typeof error === "object" ? error as { detail?: unknown; message?: unknown; _tag?: unknown } : undefined;
  if (typeof o?.detail === "string") return o.detail;
  if (fallback !== undefined) return fallback;
  if (typeof o?.message === "string" && o.message) return o.message;
  if (typeof o?._tag === "string") return o._tag;
  return String(error);
};
