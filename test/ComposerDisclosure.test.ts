import assert from "node:assert/strict";
import { test } from "node:test";
import type { PromptSubmission } from "../shared/wire.ts";
import {
  confirmDisclosure,
  initialDisclosure,
  keepComposing,
  observeDraft,
} from "../web/src/lib/composerDisclosure.ts";
import { EMPTY_DRAFT } from "../web/src/lib/messageDraft.ts";

const sent = () => ({ open: true, draft: EMPTY_DRAFT, pending: "own-input" });
const receipt = (outcome: PromptSubmission["outcome"], inputId = "own-input") => ({
  id: 1,
  inputId,
  outcome,
});

test("only an accepted own submission closes an untouched empty composer", () => {
  for (const outcome of ["started", "queued", "handled"] as const)
    assert.equal(confirmDisclosure(sent(), receipt(outcome), false).open, false);
  for (const outcome of ["submitting", "not_sent", "rejected", "uncertain"] as const)
    assert.equal(confirmDisclosure(sent(), receipt(outcome), false).open, true);
  assert.equal(confirmDisclosure(sent(), receipt("started", "another-tab"), false).open, true);
  assert.equal(confirmDisclosure(sent(), undefined, false).open, true);
  const blocked = confirmDisclosure(sent(), receipt("started"), true);
  assert.equal(blocked.open, true);
  assert.equal(
    confirmDisclosure(blocked, receipt("started"), false).open,
    true,
    "a receipt blocked by the layout or queue does not close the editor later",
  );
});

test("editing, re-opening or any newer interaction cancels send's permission to close", () => {
  const newer = { ...EMPTY_DRAFT, text: "next question" };
  const edited = observeDraft(sent(), newer);
  assert.equal(confirmDisclosure(edited, receipt("started"), false).open, true);
  const deleted = observeDraft(edited, { ...EMPTY_DRAFT });
  assert.equal(
    confirmDisclosure(deleted, receipt("started"), false).open,
    true,
    "typing then deleting is still newer work",
  );
  assert.equal(confirmDisclosure(keepComposing(sent()), receipt("started"), false).open, true);
});

test("closed drafts stay intact until changed; external input and feedback reveal them", () => {
  assert.equal(initialDisclosure(EMPTY_DRAFT).open, false);
  const draft = { ...EMPTY_DRAFT, text: "one\ntwo" };
  assert.equal(initialDisclosure(draft).open, true);
  const closed = { open: false, draft };
  assert.equal(
    observeDraft(closed, draft),
    closed,
    "explicit close does not discard or reopen a draft",
  );
  for (const next of [
    { ...draft, text: "restored\n\nnewer edits" },
    { ...draft, quotes: ["context"] },
    { ...EMPTY_DRAFT, images: { ...EMPTY_DRAFT.images, busy: true } },
    { ...EMPTY_DRAFT, images: { ...EMPTY_DRAFT.images, error: "Could not read image" } },
  ]) {
    const shown = observeDraft(closed, next);
    assert.equal(shown.open, true);
    assert.equal(shown.draft, next);
  }
  assert.equal(
    observeDraft({ open: true, draft }, EMPTY_DRAFT).open,
    true,
    "emptying the draft is never a close event",
  );
});
