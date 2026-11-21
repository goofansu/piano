import type { VoiceHints } from "@features/voice-input/contracts/voiceInput";
import { dictation } from "@features/voice-input/web/browserDictation";
import { useVoiceInput } from "@features/voice-input/web/useVoiceInput";
import { MicIcon } from "lucide-react";
import type { RefObject } from "react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Spinner } from "@/components/ui/spinner";
import { ComposerActionButton } from "@/shared/components/ComposerActionButton";
import type { DictationTarget } from "./dictation.ts";

export function VoiceInputButton({
  drafts,
  editor,
  session,
  disabled,
}: {
  drafts: DictationTarget["drafts"];
  editor: { key: DictationTarget["key"]; ref: RefObject<HTMLTextAreaElement | null> };
  session: () => VoiceHints;
  disabled: boolean;
}) {
  const voice = useVoiceInput();
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
