import { LibraryProposalCard } from "@features/library/web/browser";
import type { PendingDialogs } from "@features/sessions/web";
import { Question } from "@features/sessions/web/browser";
import { readProposal } from "@shared/session/libraryTools";
import type { Client } from "@/shared/state/client";
export function InlineQuestion({
  pending: { head, presentation, more, attachment, session },
  send,
}: {
  pending: PendingDialogs;
  send: Client["send"];
}) {
  if (!head || presentation !== "inline") return null;
  const proposal = readProposal(head);
  if (proposal)
    return (
      <LibraryProposalCard
        key={`${head.generation}/${head.id}`}
        dialog={head}
        proposal={proposal}
        attachment={attachment}
        send={send}
      />
    );
  return (
    <Question
      key={`${head.generation}/${head.id}`}
      dialog={head}
      more={more}
      attachment={attachment}
      session={session}
      send={send}
    />
  );
}
