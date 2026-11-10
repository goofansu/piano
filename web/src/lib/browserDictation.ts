import { MAX_AUDIO_BYTES } from "@shared/voiceInput";
import { toast } from "sonner";
import { ApiError, transcribe } from "@/lib/api";
import { createDictation } from "@/lib/dictation";
import { voiceInputSettings } from "@/lib/useVoiceInput";
import { recordingType } from "@/lib/voiceInput";

const base64 = (blob: Blob, signal: AbortSignal) =>
  new Promise<string>((resolve, reject) => {
    signal.throwIfAborted();
    if (blob.size > MAX_AUDIO_BYTES) return reject(new Error("Recording exceeds the upload limit"));
    const reader = new FileReader();
    const abort = () => reader.abort();
    reader.onloadend = () => signal.removeEventListener("abort", abort);
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    reader.readAsDataURL(blob);
  });

/** One microphone per page. Transcription always uses main, never the selected peer's APIs. */
export const dictation = createDictation({
  supported: () => !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined",
  microphone: () => navigator.mediaDevices.getUserMedia({ audio: true }),
  record: (stream, events) => {
    const type = recordingType((t) => MediaRecorder.isTypeSupported(t));
    const recorder = type
      ? new MediaRecorder(stream as MediaStream, { mimeType: type })
      : new MediaRecorder(stream as MediaStream);
    const tracks = (stream as MediaStream).getTracks();
    const detach = () =>
      tracks.forEach((track) => track.removeEventListener("ended", events.error));
    tracks.forEach((track) => track.addEventListener("ended", events.error));
    recorder.ondataavailable = (event) => events.data(event.data);
    recorder.onerror = () => {
      detach();
      events.error();
    };
    recorder.onstop = () => {
      detach();
      events.stop();
    };
    return {
      get state() {
        return recorder.state;
      },
      get mimeType() {
        return recorder.mimeType || type || "";
      },
      start: () => {
        try {
          recorder.start(1000);
        } catch (error) {
          detach();
          throw error;
        }
      },
      stop: () => {
        detach();
        recorder.stop();
      },
    };
  },
  transcribe: async (audio, hints, signal) => {
    const encoded = await base64(audio, signal);
    signal.throwIfAborted();
    return (await transcribe({ audio: encoded, mimeType: audio.type, hints }, { signal })).text;
  },
  failed: (error) => {
    toast.error(error instanceof ApiError ? error.message : "Could not transcribe the recording.");
    void voiceInputSettings.refresh();
  },
  notify: { info: (message) => toast.info(message), error: (message) => toast.error(message) },
  nextFrame: (run) => requestAnimationFrame(run),
});

/** Hidden/locked pages discard live recordings; committed transcripts survive ordinary switches. */
export function observeDictationPage() {
  const hidden = () => {
    if (document.hidden) dictation.cancelRecording();
  };
  const leaving = () => dictation.dispose();
  document.addEventListener("visibilitychange", hidden);
  window.addEventListener("pagehide", leaving);
  return () => {
    document.removeEventListener("visibilitychange", hidden);
    window.removeEventListener("pagehide", leaving);
    dictation.dispose();
  };
}
