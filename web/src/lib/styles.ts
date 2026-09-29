/** Class strings shared by controls that live inside the composer card. */

/** A quiet picker: reads as text until hovered, sits on the composer's footer row. */
export const picker =
  "inline-flex h-8 max-w-[16rem] items-center gap-1 rounded-md px-2 text-sm font-normal text-ink-2 hover:bg-fill-hover hover:text-ink data-[state=open]:bg-fill-hover data-[state=open]:text-ink";

/** The composer card itself: layer 1; focus only firms up the edge. */
export const composerCard = "rounded-2xl border border-line bg-surface-1 shadow-1 transition-[border-color] focus-within:border-line-strong";
