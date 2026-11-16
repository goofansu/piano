import { MAX_HINT_LENGTH, RECORDING_TYPES, type VoiceHints } from "../../../shared/voiceInput.ts";

const named = (value: string | undefined) =>
  value?.trim() ? value.trim().slice(0, MAX_HINT_LENGTH) : undefined;

const FIELDS = ["project", "folder", "branch", "session"] as const;

export function voiceHints(place: VoiceHints): VoiceHints {
  return Object.fromEntries(
    FIELDS.flatMap((field) => {
      const name = named(place[field]);
      return name ? [[field, name]] : [];
    }),
  );
}

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

export function recordingType(isSupported: (type: string) => boolean): string | undefined {
  return RECORDING_TYPES.find((r) => r.requested && isSupported(r.mimeType))?.mimeType;
}
