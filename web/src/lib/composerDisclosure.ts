import type { PromptSubmission } from "@shared/wire";
import type { Draft } from "./messageDraft.ts";

/** Presentation only: a closed editor retains its exact draft. A changed draft is revealed,
 * while only this view's confirmed send may close an untouched, empty editor. */
export interface ComposerDisclosure {
  open: boolean;
  draft: Draft;
  pending?: string;
}

export const draftNeedsReview = (draft: Draft): boolean =>
  !!(
    draft.text.length ||
    draft.quotes.length ||
    draft.images.items.length ||
    draft.images.busy ||
    draft.images.error
  );

export const initialDisclosure = (draft: Draft): ComposerDisclosure => ({
  open: draftNeedsReview(draft),
  draft,
});

/** Also covers quotes, queue restoration, refused input and asynchronous image reads. */
export const observeDraft = (state: ComposerDisclosure, draft: Draft): ComposerDisclosure =>
  state.draft === draft ? state : { open: state.open || draftNeedsReview(draft), draft };

/** An explicit interaction after Send supersedes its permission to close the editor. */
export const keepComposing = (state: ComposerDisclosure): ComposerDisclosure =>
  state.pending === undefined ? state : { open: state.open, draft: state.draft };

export function confirmDisclosure(
  state: ComposerDisclosure,
  submission: PromptSubmission | undefined,
  blocked: boolean,
): ComposerDisclosure {
  if (
    !state.pending ||
    state.pending !== submission?.inputId ||
    submission.outcome === "submitting"
  )
    return state;
  const accepted = ["started", "queued", "handled"].includes(submission.outcome);
  return {
    open: accepted && !blocked && !draftNeedsReview(state.draft) ? false : state.open,
    draft: state.draft,
  };
}
