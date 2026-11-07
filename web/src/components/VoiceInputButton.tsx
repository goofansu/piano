import { MAX_RECORDING_MS } from "@shared/voiceInput";
import { MicIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { DraftEditorState } from "@/components/DraftEditor";
import { IconButton } from "@/components/IconButton";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, sessionCommands, transcribe } from "@/lib/api";
import { useVoiceInput, voiceInputSettings } from "@/lib/useVoiceInput";
import { insertDictation, recordingType, type VoiceSession, voiceHints } from "@/lib/voiceInput";

type Phase = "idle" | "starting" | "recording" | "transcribing";

interface Recording {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  limit: ReturnType<typeof setTimeout>;
  commands: Promise<readonly string[]>;
}

const base64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const microphoneRefusal = (error: unknown) =>
  error instanceof DOMException && error.name === "NotAllowedError"
    ? "Allow microphone access to use voice input."
    : error instanceof DOMException && error.name === "NotFoundError"
      ? "No microphone found."
      : "Could not start recording.";

/**
 * The composer's microphone, shown while voice input is on: press to record, press again to put
 * the transcript into the draft at the cursor. Recording and transcribing stay in this browser
 * tab; the transcript is never sent on its own.
 */
export function VoiceInputButton({
  editor,
  session,
  live,
  disabled,
}: {
  editor: DraftEditorState;
  /** Read when a recording stops, so its hints are the session as it is then. */
  session: () => VoiceSession;
  /** A running session's IDs: its commands are read from it. A saved session starts nothing. */
  live?: { workspaceId: string; sessionId: string };
  disabled: boolean;
}) {
  // Shared with Settings: turning voice input on or off there shows or hides this at once.
  const voice = useVoiceInput();
  const [phase, setPhase] = useState<Phase>("idle");
  const recording = useRef<Recording | null>(null);
  const aborted = useRef<AbortController | null>(null);
  const latest = useRef({ editor, session, live });
  latest.current = { editor, session, live };

  const release = () => {
    const current = recording.current;
    recording.current = null;
    if (!current) return;
    clearTimeout(current.limit);
    for (const track of current.stream.getTracks()) track.stop();
  };
  // Leaving the session stops the microphone and drops a transcript nobody would see land.
  useEffect(
    () => () => {
      const current = recording.current;
      if (current && current.recorder.state !== "inactive") {
        current.recorder.onstop = null;
        current.recorder.stop();
      }
      release();
      aborted.current?.abort();
    },
    [],
  );

  const finish = async (chunks: Blob[], type: string, commands: Promise<readonly string[]>) => {
    const audio = new Blob(chunks, { type });
    if (audio.size === 0) {
      setPhase("idle");
      return;
    }
    setPhase("transcribing");
    const controller = new AbortController();
    aborted.current = controller;
    try {
      const { editor: draft, session: current } = latest.current;
      const field = draft.ref.current;
      const before = draft.text.slice(0, field?.selectionStart ?? draft.text.length);
      const hints = voiceHints({ ...current(), commands: await commands }, before);
      const { text } = await transcribe(
        { audio: await base64(audio), mimeType: type, hints },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (!text) {
        toast.info("No speech was heard.");
        return;
      }
      // Where the cursor is now: typing may have moved it while OpenAI answered.
      const { editor: now } = latest.current;
      const input = now.ref.current;
      const at = input
        ? { start: input.selectionStart, end: input.selectionEnd }
        : { start: now.text.length, end: now.text.length };
      const next = insertDictation(now.text, at, text);
      now.setText(next.text);
      requestAnimationFrame(() => {
        const target = latest.current.editor.ref.current;
        if (!target) return;
        target.focus();
        target.setSelectionRange(next.caret, next.caret);
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      toast.error(
        error instanceof ApiError ? error.message : "Could not transcribe the recording.",
      );
      // A refusal may mean voice input changed elsewhere: read it again.
      void voiceInputSettings.refresh();
    } finally {
      if (aborted.current === controller) aborted.current = null;
      setPhase("idle");
    }
  };

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("This browser cannot record audio here. Voice input needs HTTPS or localhost.");
      return;
    }
    setPhase("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      setPhase("idle");
      toast.error(microphoneRefusal(error));
      return;
    }
    const type = recordingType((t) => MediaRecorder.isTypeSupported(t));
    const recorder = type
      ? new MediaRecorder(stream, { mimeType: type })
      : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const { live: target } = latest.current;
    // Read while the speaker talks; a failure only loses the command hints.
    const commands = target
      ? sessionCommands(target.workspaceId, target.sessionId)
          .then((list) => list.map((c) => c.name))
          .catch(() => [] as string[])
      : Promise.resolve([] as string[]);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      release();
      void finish(chunks, recorder.mimeType || type || "audio/webm", commands);
    };
    recording.current = {
      recorder,
      stream,
      chunks,
      commands,
      limit: setTimeout(() => {
        if (recorder.state !== "inactive") {
          toast.info("Recording stopped at 10 minutes.");
          recorder.stop();
        }
      }, MAX_RECORDING_MS),
    };
    recorder.start();
    setPhase("recording");
  };

  const stop = () => {
    const current = recording.current;
    if (current && current.recorder.state !== "inactive") current.recorder.stop();
  };

  if (!voice.value?.enabled && phase === "idle") return null;
  const recordingNow = phase === "recording";
  const busy = phase === "starting" || phase === "transcribing";
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
      onClick={() => (recordingNow ? stop() : void start())}
    >
      {busy ? <Spinner /> : recordingNow ? <SquareIcon className="fill-current" /> : <MicIcon />}
    </IconButton>
  );
}
