import { LIBRARY_KINDS, type LibraryProposal } from "@shared/library";
import type { Dialog } from "@shared/wire";
import { lazy, Suspense, useId, useState } from "react";
import { DraftFileText } from "@/components/DraftDialogs";
import { Button } from "@/components/ui/button";
import type { Client } from "@/lib/client";
import { ScrollRootContext } from "@/lib/scrollRoot";
import { useDialogAnswer } from "@/lib/useDialogAnswer";

const CodeTextDiff = lazy(() =>
  import("@/components/Code").then(
    ({ CodeTextDiff }) => ({ default: CodeTextDiff }),
    () => ({
      default: () => (
        <p className="px-3 py-2 text-xs text-ink-3">
          Could not load the diff viewer. Reload Piano and try again.
        </p>
      ),
    }),
  ),
);

/** Texts that differ only in a final newline have no text changes. */
const sameLines = (a: string, b: string) => a.replace(/\n$/, "") === b.replace(/\n$/, "");

/**
 * What a save tool would write, asked where `ask_user` asks: the new file as plain text, or a diff
 * against the saved one, and Create (or Save, for an update) or Cancel. The card carries no explanation; where the save
 * applies is the transcript row's fact. A proposal Piano had to redact (`dialog.concealed`) shows
 * what is hidden as hidden and offers only Cancel: confirming would write text the person never saw.
 */
export function LibraryProposalCard({
  dialog,
  proposal,
  attachment,
  send,
}: {
  dialog: Dialog;
  proposal: LibraryProposal;
  attachment: string | null;
  send: Client["send"];
}) {
  const id = useId();
  const { answer, cancel, submitted, disabled, waiting } = useDialogAnswer(
    dialog,
    attachment,
    send,
  );
  const { kind, change, name, file, previous } = proposal;
  const { fileLabel } = LIBRARY_KINDS[kind];
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  return (
    <section aria-label="Proposal" className="px-(--gutter) pt-3">
      <form
        aria-labelledby={`${id}-title`}
        data-slot="library-proposal"
        className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-md border border-line bg-surface-1 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!dialog.concealed) answer({ confirmed: true });
        }}
      >
        <h2 id={`${id}-title`} className="min-w-0 truncate text-sm font-medium text-ink">
          {change === "create" ? "New" : "Update"} {kind}:{" "}
          <span className="font-mono font-normal">{name}</span>
        </h2>
        {previous !== undefined ? (
          sameLines(previous, file) ? (
            dialog.concealed ? null : (
              <p className="text-sm text-ink-3">No text changes.</p>
            )
          ) : (
            <div
              ref={setScroller}
              className="max-h-[min(20rem,40dvh)] overflow-y-auto overscroll-contain rounded-md border border-line [&>section]:border-t-0"
            >
              <ScrollRootContext value={scroller}>
                <Suspense fallback={null}>
                  <CodeTextDiff
                    name={name}
                    before={previous}
                    after={file}
                    label={`Diff of ${name} ${fileLabel}`}
                  />
                </Suspense>
              </ScrollRootContext>
            </div>
          )
        ) : (
          <DraftFileText kind={kind} name={name} file={file} className="max-h-[min(20rem,40dvh)]" />
        )}
        <div className="flex items-center justify-end gap-2">
          {dialog.concealed && <p className="mr-auto text-sm text-ink-2">Contains hidden text</p>}
          <Button type="button" variant="outline" disabled={disabled} onClick={cancel}>
            Cancel
          </Button>
          {!dialog.concealed && (
            <Button type="submit" disabled={disabled}>
              {change === "create" ? "Create" : "Save"} {kind}
            </Button>
          )}
        </div>
        {submitted && (
          <p role="status" className="text-sm text-ink-2">
            {waiting}
          </p>
        )}
      </form>
    </section>
  );
}
