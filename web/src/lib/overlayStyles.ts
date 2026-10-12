/** Anchored overlays scale in place; shadcn's directional slide defaults are neutralized explicitly. */
export const anchoredMotion =
  "data-[side=bottom]:slide-in-from-top-0 data-[side=left]:slide-in-from-right-0 data-[side=right]:slide-in-from-left-0 data-[side=top]:slide-in-from-bottom-0";

/** Piano's raised layer sits above toasts, with a short entrance and tokenized exit. */
export const raisedOverlay =
  "z-[60] rounded-lg duration-[160ms] ease-(--ease-enter) data-[state=closed]:duration-(--dur-exit) data-[state=closed]:ease-(--ease-exit) data-[state=closed]:zoom-out-[0.96] data-[state=open]:zoom-in-[0.96]";
