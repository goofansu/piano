/**
 * Voice input in the composer: the hints a recording carries, and where its transcript lands in
 * the draft. The server turns the hints into OpenAI's prompt.
 */
// Relative, not @shared: module tests load this file directly in Node.
import { MAX_HINT_LENGTH, RECORDING_TYPES, type VoiceHints } from "../../../shared/voiceInput.ts";

const named = (value: string | undefined) =>
  value?.trim() ? value.trim().slice(0, MAX_HINT_LENGTH) : undefined;

const FIELDS = ["project", "folder", "branch", "session"] as const;

/** What a recording sends: each name trimmed and clipped to what the server accepts, blanks left out. */
export function voiceHints(place: VoiceHints): VoiceHints {
  return Object.fromEntries(
    FIELDS.flatMap((field) => {
      const name = named(place[field]);
      return name ? [[field, name]] : [];
    }),
  );
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
  return RECORDING_TYPES.find((r) => r.requested && isSupported(r.mimeType))?.mimeType;
}
