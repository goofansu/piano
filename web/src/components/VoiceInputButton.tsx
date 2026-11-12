import type { VoiceHints } from "@shared/voiceInput";
import { MicIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { ComposerActionButton } from "@/components/ComposerActionButton";
import type { DraftEditorState } from "@/components/DraftEditor";
import { Spinner } from "@/components/ui/spinner";
import { dictation } from "@/lib/browserDictation";
import { useDrafts } from "@/lib/useMachine";
import { useVoiceInput } from "@/lib/useVoiceInput";

/** Main-owned dictation into this machine's draft; the user reviews it before sending. */
export function VoiceInputButton({
  editor,
  session,
  disabled,
}: {
  editor: DraftEditorState;
  session: () => VoiceHints;
  disabled: boolean;
}) {
  const voice = useVoiceInput();
  const drafts = useDrafts();
  const { key, ref } = editor;
  const target = useMemo(() => ({ drafts, key }), [drafts, key]);
  const phase = useSyncExternalStore(dictation.subscribe, () => dictation.phase(target));
  const shown = useRef({ target, session });
  shown.current = { target, session };
  useEffect(() => () => dictation.cancel(target), [target]);

  if (!voice.value?.enabled && phase === "idle") return null;
  const recordingNow = phase === "recording";
  const busy = phase === "starting" || phase === "transcribing";
  const start = () => {
    const own = session;
    const here = () => shown.current.target === target;
    void dictation.start(target, {
      session: () => (here() ? shown.current.session() : own()),
      field: () => (here() ? ref.current : null),
    });
  };
  return (
    <ComposerActionButton
      type="button"
      variant={recordingNow ? "destructive" : "secondary"}
      label={
        phase === "transcribing"
          ? "Cancel transcription"
          : phase === "starting"
            ? "Cancel recording"
            : recordingNow
              ? "Stop recording"
              : "Voice input"
      }
      aria-pressed={recordingNow}
      aria-busy={busy || undefined}
      disabled={disabled && phase === "idle"}
      onClick={() =>
        busy ? dictation.cancel(target, true) : recordingNow ? dictation.stop(target) : start()
      }
    >
      {/* Recording keeps the mic on a red face: the square belongs to the turn's Stop beside it. */}
      {busy ? <Spinner /> : <MicIcon />}
    </ComposerActionButton>
  );
}
