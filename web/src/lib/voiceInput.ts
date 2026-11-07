/**
 * Voice input in the composer: the session hints a recording carries, and where its transcript
 * lands in the draft. The server turns the hints into OpenAI's prompt and keywords.
 */
// Relative, not @shared: module tests load this file directly in Node.
import type { VoiceHints } from "../../../shared/voiceInput.ts";
import type { RenderMsg } from "../../../shared/wire.ts";
import { sessionFiles } from "./sessionFiles.ts";

const RECENT_MESSAGES = 4;
const RECENT_CHARS = 2000;
const DRAFT_CHARS = 2000;
const SHORT = 512;

const head = (text: string, max: number) => (text.length <= max ? text : text.slice(0, max));
const tail = (text: string, max: number) =>
  text.length <= max ? text : text.slice(text.length - max);
const named = (value: string | undefined) =>
  value?.trim() ? head(value.trim(), SHORT) : undefined;

export interface VoiceSession {
  project?: string;
  folder?: string;
  branch?: string;
  title?: string;
  messages: ReadonlyArray<RenderMsg>;
  /** Slash command names, when the session's commands are at hand. */
  commands?: ReadonlyArray<string>;
}

/** What a recording tells the server about where it is dictated: the session and the draft before the cursor. */
export function voiceHints(session: VoiceSession, draftBeforeCursor: string): VoiceHints {
  const recent = session.messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.text.trim())
    .slice(-RECENT_MESSAGES)
    // The end of a long reply is what the speaker answers.
    .map((m) => tail(m.text.trim(), RECENT_CHARS));
  const files = sessionFiles(session.messages)
    .map((file) => head(file.placed ?? file.path, SHORT))
    .slice(-200);
  const commands = (session.commands ?? []).map((name) => head(name, SHORT)).slice(0, 500);
  const draft = tail(draftBeforeCursor, DRAFT_CHARS);
  return {
    ...(named(session.project) && { project: named(session.project) }),
    ...(named(session.folder) && { folder: named(session.folder) }),
    ...(named(session.branch) && { branch: named(session.branch) }),
    ...(named(session.title) && { session: named(session.title) }),
    ...(draft.trim() && { draft }),
    ...(recent.length && { recent }),
    ...(files.length && { files }),
    ...(commands.length && { commands }),
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
