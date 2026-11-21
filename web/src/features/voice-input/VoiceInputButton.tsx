import type { VoiceHints } from "@shared/features/voice-input/voiceInput";
import { MicIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useDrafts } from "@/app/usePageStores";
import { Spinner } from "@/components/ui/spinner";
import { ComposerActionButton } from "@/features/sessions/composer/ComposerActionButton";
import type { DraftEditorState } from "@/features/sessions/composer/DraftEditor";
import { dictation } from "@/features/voice-input/browserDictation";
import { useVoiceInput } from "@/features/voice-input/useVoiceInput";

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
      face={recordingNow ? "recording" : "neutral"}
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
      {busy ? <Spinner /> : <MicIcon />}
    </ComposerActionButton>
  );
}
