/** Class strings shared by controls that live inside the composer card, and by rows that fold or list. */

/** A quiet picker: reads as text until hovered, sits on the composer's footer row. Touch-sized on phones. */
export const picker =
  "inline-flex h-11 max-w-[16rem] items-center gap-1 rounded-md px-2 text-sm font-normal text-ink-2 hover:bg-fill-hover hover:text-ink data-[state=open]:bg-fill-hover data-[state=open]:text-ink md:h-8";

/** Shared surface and focus treatment for the first-message and session composers. */
export const composerCard = "composer-card font-sans";

/** The input grows with content; on phones it leaves room for the keyboard and toolbar. */
export const composerInput =
  "max-h-[min(12rem,30dvh)] min-h-14 resize-none border-0 bg-transparent px-4 pt-4 font-sans shadow-none dark:bg-transparent focus-visible:ring-0 md:px-5";

/** Compact settings yield space to the primary action without wrapping to another row. */
export const composerToolbar =
  "flex min-w-0 flex-nowrap items-center gap-1 px-2.5 pb-2.5 font-mono text-sm text-ink-2";
export const composerAction = "ml-auto size-11 shrink-0 rounded-xl md:size-9";

/** A folding row in the transcript gutter: full width, quiet hover, a focus ring; the chevron sits at its end.
 * Its padding lies outside the flow (negative margins), so its first line stays on the gutter glyph's line
 * whatever Row holds it; test/browser/transcript-rows.mjs measures every row kind. */
export const disclosureRow =
  "-ml-2 -my-1 flex w-[calc(100%+0.5rem)] min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left outline-none hover:bg-fill-hover focus-visible:ring-2 focus-visible:ring-ring";

/** A plain row in a list (folder entries, the jump list): hover and keyboard focus read the same. */
export const listRow =
  "flex w-full items-center gap-2 text-left text-sm outline-none hover:bg-fill-hover focus-visible:bg-fill-hover";
