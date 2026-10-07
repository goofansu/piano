/** Class strings shared by controls that live inside the composer card. */

/** A quiet picker: reads as text until hovered, sits on the composer's footer row. */
export const picker =
  "inline-flex h-8 max-w-[16rem] items-center gap-1 rounded-md px-2 text-sm font-normal text-ink-2 transition-colors duration-(--dur-hover) hover:bg-fill-hover hover:text-ink data-[state=open]:bg-fill-hover data-[state=open]:text-ink";

/** Shared surface and focus treatment for the first-message and session composers. */
export const composerCard = "composer-card font-mono";

/** The input grows with content; on phones it leaves room for the keyboard and toolbar. */
export const composerInput = "max-h-[min(12rem,calc(var(--app-viewport-height,100dvh)*0.3))] min-h-14 resize-none border-0 bg-transparent px-4 pt-4 font-sans shadow-none dark:bg-transparent focus-visible:ring-0 md:px-5";

/** Compact settings yield space to the primary action without wrapping to another row. */
export const composerToolbar = "flex min-w-0 flex-nowrap items-center gap-1 px-2.5 pb-2.5 text-sm text-ink-2";
export const composerAction = "ml-auto size-11 shrink-0 rounded-xl transition-[background-color,color,border-color,transform,opacity] duration-(--dur-hover) active:scale-95 md:size-9";
