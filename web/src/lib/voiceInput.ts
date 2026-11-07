/**
 * Voice input in the composer: the hints a recording carries, and where its transcript lands in
 * the draft. The server turns the hints into OpenAI's prompt.
 */
// Relative, not @shared: module tests load this file directly in Node.
import type { VoiceHints } from "../../../shared/voiceInput.ts";

const SHORT = 512;

const named = (value: string | undefined) =>
  value?.trim() ? value.trim().slice(0, SHORT) : undefined;

/** Where a message is dictated: the names voice input spells by. */
export interface VoiceSession {
  project?: string;
  folder?: string;
  branch?: string;
  title?: string;
}

/** What a recording tells the server about where it is dictated. */
export function voiceHints(session: VoiceSession): VoiceHints {
  return {
    ...(named(session.project) && { project: named(session.project) }),
    ...(named(session.folder) && { folder: named(session.folder) }),
    ...(named(session.branch) && { branch: named(session.branch) }),
    ...(named(session.title) && { session: named(session.title) }),
  };
}

/**
 * The draft with a transcript put in place of the selection, a space apart from the words beside
 * it, and where the caret goes after it.
 */
export function insertDictation(
  draft: string,
  selection: { start: number; end: number },
  transcript: string,
): { text: string; caret: number } {
  const spoken = transcript.trim();
  const start = Math.max(0, Math.min(selection.start, draft.length));
  const end = Math.max(start, Math.min(selection.end, draft.length));
  if (!spoken) return { text: draft, caret: end };
  const before = draft.slice(0, start);
  const after = draft.slice(end);
  const lead = before && !/\s$/.test(before) && !/^[,.;:!?)]/.test(spoken) ? " " : "";
  const trail = after && !/^\s/.test(after) && !/^[,.;:!?)]/.test(after) ? " " : "";
  const inserted = `${lead}${spoken}${trail}`;
  return { text: before + inserted + after, caret: before.length + lead.length + spoken.length };
}

/** The first recording format this browser makes that OpenAI reads; undefined lets it choose. */
export function recordingType(isSupported: (type: string) => boolean): string | undefined {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find(
    (type) => isSupported(type),
  );
}
