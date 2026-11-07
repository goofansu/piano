import type { VoiceHints } from "@shared/voiceInput";
import { MicIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { DraftEditorState } from "@/components/DraftEditor";
import { IconButton } from "@/components/IconButton";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, transcribe } from "@/lib/api";
import { createDictation } from "@/lib/dictation";
import { drafts } from "@/lib/messageDraft";
import { useVoiceInput, voiceInputSettings } from "@/lib/useVoiceInput";
import { recordingType } from "@/lib/voiceInput";

const base64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** The page's dictations, one per draft, recorded with this browser's microphone. */
const dictation = createDictation({
  drafts,
  supported: () => !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined",
  microphone: () => navigator.mediaDevices.getUserMedia({ audio: true }),
  record: (stream, events) => {
    const type = recordingType((t) => MediaRecorder.isTypeSupported(t));
    const recorder = type
      ? new MediaRecorder(stream as MediaStream, { mimeType: type })
      : new MediaRecorder(stream as MediaStream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) events.data(event.data);
    };
    recorder.onstop = events.stop;
    return {
      get state() {
        return recorder.state;
      },
      get mimeType() {
        return recorder.mimeType || type || "";
      },
      start: () => recorder.start(),
      stop: () => recorder.stop(),
    };
  },
  transcribe: async (audio, hints) =>
    (await transcribe({ audio: await base64(audio), mimeType: audio.type, hints })).text,
  failed: (error) => {
    toast.error(error instanceof ApiError ? error.message : "Could not transcribe the recording.");
    // A refusal may mean voice input changed elsewhere: read it again.
    void voiceInputSettings.refresh();
  },
  notify: { info: (message) => toast.info(message), error: (message) => toast.error(message) },
  nextFrame: (run) => requestAnimationFrame(run),
});

/**
 * The composer's microphone, shown while voice input is on: press to record, press again to put
 * the transcript into the draft at the cursor. Recording and transcribing stay in this browser
 * tab; the transcript is never sent on its own. See `createDictation` for which draft it lands in.
 */
export function VoiceInputButton({
  editor,
  session,
  disabled,
}: {
  editor: DraftEditorState;
  /** Read when a recording stops, so its hints are the session as it is then. */
  session: () => VoiceHints;
  disabled: boolean;
}) {
  // Shared with Settings: turning voice input on or off there shows or hides this at once.
  const voice = useVoiceInput();
  const { key, ref } = editor;
  const phase = useSyncExternalStore(dictation.subscribe, () => dictation.phase(key));
  // What the composer shows now; a dictation reads it only while it still shows that draft.
  const shown = useRef({ key, session });
  shown.current = { key, session };

  // Showing another draft, or leaving, stops the microphone and drops what was not yet stopped.
  useEffect(() => () => dictation.cancel(key), [key]);

  if (!voice.value?.enabled && phase === "idle") return null;
  const recordingNow = phase === "recording";
  const busy = phase === "starting" || phase === "transcribing";
  const start = () => {
    const own = session;
    const here = () => shown.current.key === key;
    return dictation.start(key, {
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
        phase === "transcribing" ? "Transcribing…" : recordingNow ? "Stop recording" : "Voice input"
      }
      aria-pressed={recordingNow}
      aria-busy={busy || undefined}
      disabled={busy || (disabled && !recordingNow)}
      onClick={() => (recordingNow ? dictation.stop(key) : void start())}
    >
      {busy ? <Spinner /> : recordingNow ? <SquareIcon className="fill-current" /> : <MicIcon />}
    </IconButton>
  );
}
