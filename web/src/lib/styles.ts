/** Class strings shared by controls that live inside the composer card, and by rows that fold or list. */

/** A quiet picker: reads as text until hovered. Coarse pointers keep a 44px target at any viewport width. */
export const picker =
  "inline-flex h-11 max-w-[16rem] items-center gap-1 rounded-md px-2 text-sm font-normal text-ink-2 hover:bg-fill-hover hover:text-ink data-[state=open]:bg-fill-hover data-[state=open]:text-ink md:h-8 pointer-coarse:min-h-11 pointer-coarse:min-w-11";

/** The composer footer's machine-value pickers (model, delivery): mono captions on the trigger, and menus whose
 * rows drop to the caption scale on phones, where the label scale would outsize the footer they open from. */
export const footerPicker = `${picker} font-mono text-xs`;
export const footerPickerMenu = "font-mono max-md:[--type-label:var(--type-caption)]";

/** Shared surface and focus treatment for the first-message and session composers. */
export const composerCard = "composer-card font-sans";

/** The input grows with content; on phones it leaves room for the keyboard and toolbar. */
export const composerInput =
  "max-h-[min(12rem,30dvh)] min-h-14 resize-none border-0 bg-transparent px-4 pt-4 font-sans shadow-none dark:bg-transparent focus-visible:ring-0 md:px-5";

/** Compact settings yield space to the primary action without wrapping to another row. */
export const composerToolbar =
  "flex min-w-0 flex-nowrap items-center gap-1 px-2.5 pb-2.5 font-mono text-sm text-ink-2";
/** The real target stays 44px on phones/touch; its separate face stays desktop-sized. */
export const composerAction =
  "size-11 shrink-0 rounded-full border-0 p-0 md:size-9 pointer-coarse:min-h-11 pointer-coarse:min-w-11";
// The outer button owns press motion; the decorative span must not translate a second time.
// Fills reach the border box: clipped to padding, a borderless face paints 2px smaller than Stop's outlined one.
// A neutral face (mic, Stop) takes the stronger fill: at the base 6% its edge fades beside solid Send.
export const composerActionFace =
  "relative size-9 rounded-full bg-clip-border [--secondary:var(--fill-active)] active:not-aria-[haspopup]:translate-none";

/** Attach keeps its small ghost icon while reserving a nonoverlapping touch target. */
export const composerIcon = "shrink-0 pointer-coarse:size-11";

/** A folding row in the transcript gutter: full width, quiet hover, a focus ring; the chevron sits at its end.
 * Its padding lies outside the flow (negative margins), so its first line stays on the gutter glyph's line
 * whatever Row holds it; test/browser/transcript-rows.mjs measures every row kind. */
export const disclosureRow =
  "-ml-2 -my-1 flex w-[calc(100%+0.5rem)] min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left outline-none hover:bg-fill-hover focus-visible:ring-2 focus-visible:ring-ring";

/** A plain row in a list (folder entries, the jump list): hover and keyboard focus read the same. */
export const listRow =
  "flex w-full items-center gap-2 text-left text-sm outline-none hover:bg-fill-hover focus-visible:bg-fill-hover";
