import type { LibraryProposal } from "@shared/library";
import type { Dialog } from "@shared/wire";
import { useId, useMemo } from "react";
import { Hunks } from "@/components/Changes";
import { DraftFileText } from "@/components/DraftDialogs";
import { Button } from "@/components/ui/button";
import type { Client } from "@/lib/client";
import { lineDiff } from "@/lib/lineDiff";
import { useDialogAnswer } from "@/lib/useDialogAnswer";

/**
 * What a save tool would write, asked where `ask_user` asks: the new file as plain text, or a diff
 * against the saved one, and Save or Cancel. The card carries no explanation; where the save
 * applies is the transcript row's fact.
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
  const fileLabel = kind === "skill" ? "SKILL.md" : "file";
  const diff = useMemo(
    () => (previous === undefined ? undefined : lineDiff(`${name} ${fileLabel}`, previous, file)),
    [previous, file, name, fileLabel],
  );
  return (
    <section aria-label="Proposal" className="px-(--gutter) pt-3">
      <form
        aria-labelledby={`${id}-title`}
        data-slot="library-proposal"
        className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-md border border-line bg-surface-1 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          answer({ confirmed: true });
        }}
      >
        <h2 id={`${id}-title`} className="min-w-0 truncate text-sm font-medium text-ink">
          {change === "create" ? "New" : "Update"} {kind}:{" "}
          <span className="font-mono font-normal">{name}</span>
        </h2>
        {diff ? (
          diff.hunks.length ? (
            <div className="max-h-[min(20rem,40dvh)] overflow-y-auto overscroll-contain rounded-md border border-line [&>div]:border-t-0">
              <Hunks file={diff} />
            </div>
          ) : (
            <p className="text-sm text-ink-3">No text changes.</p>
          )
        ) : (
          <DraftFileText
            kind={kind}
            name={name}
            file={file}
            fileLabel={fileLabel}
            className="max-h-[min(20rem,40dvh)]"
          />
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={disabled} onClick={cancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={disabled}>
            Save {kind}
          </Button>
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
