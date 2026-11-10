import type { VoiceHints } from "@shared/voiceInput";
import { MicIcon, SquareIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { DraftEditorState } from "@/components/DraftEditor";
import { IconButton } from "@/components/IconButton";
import { Spinner } from "@/components/ui/spinner";
import { dictation } from "@/lib/browserDictation";
import { LOCAL } from "@/lib/machine";
import { useDrafts, useMachine } from "@/lib/useMachine";
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
  const machine = useMachine();
  const drafts = useDrafts();
  const { key, ref } = editor;
  const target = useMemo(() => ({ drafts, key }), [drafts, key]);
  const phase = useSyncExternalStore(dictation.subscribe, () => dictation.phase(target));
  const shown = useRef({ target, session });
  shown.current = { target, session };
  useEffect(() => () => dictation.cancel(target), [target]);

  const remote = machine && machine.machine.id !== LOCAL.id;
  if (!voice.value?.enabled && phase === "idle" && !(remote && voice.value)) return null;
  const recordingNow = phase === "recording";
  const busy = phase === "starting" || phase === "transcribing";
  const start = () => {
    if (!voice.value?.enabled) {
      const notice = toast.info("Voice input uses Local’s OpenAI key for every machine.", {
        action: {
          label: "Open Local Preferences",
          onClick: () => {
            toast.dismiss(notice);
            machine?.switchMachine(LOCAL.id, "/settings/preferences");
          },
        },
      });
      return;
    }
    const own = session;
    const here = () => shown.current.target === target;
    void dictation.start(target, {
      session: () => (here() ? shown.current.session() : own()),
      field: () => (here() ? ref.current : null),
    });
  };
  return (
    <IconButton
      size="icon-sm"
      type="button"
      className={recordingNow ? "shrink-0 text-destructive hover:text-destructive" : "shrink-0"}
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
      {busy ? <Spinner /> : recordingNow ? <SquareIcon className="fill-current" /> : <MicIcon />}
    </IconButton>
  );
}
