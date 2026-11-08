/**
 * A literal secret: an API key or bearer token a person pastes, which Piano or Pi later sends
 * verbatim in an HTTP header (`Authorization: Bearer …`). A header carries bytes, so fetch throws
 * on a character above U+00FF, such as a pasted zero-width space; a space or control character
 * would split or end the header. One rule therefore serves every surface: surrounding whitespace
 * is dropped, and what remains is visible ASCII only. The browser caps each field at the
 * same limit.
 */

export const LITERAL_SECRET_MAX = 8192;

/** The refusal of a secret holding anything but visible ASCII. */
export const SECRET_NOT_VISIBLE = "Use only visible ASCII characters, without spaces.";
/** The refusal of an API key Pi would run: it reads a leading ! as a command. */
export const API_KEY_INVALID = "Enter a valid API key, not a command.";
export const API_KEY_MISSING = "Enter an API key.";
export const SECRET_TOO_LONG = `Use at most ${LITERAL_SECRET_MAX} characters.`;

/** The secret as it is stored, or the one sentence that refuses it. */
export type ReadSecret =
  | { readonly value: string; readonly refusal?: undefined }
  | { readonly refusal: string };

/**
 * A secret where an empty one means none: "" comes back empty, for the caller to read. Spaces
 * alone are refused rather than read as empty, so they never clear a saved secret.
 */
export function readLiteralSecret(raw: string): ReadSecret {
  const value = raw.trim();
  if (/[^\x21-\x7e]/.test(value) || (raw && !value)) return { refusal: SECRET_NOT_VISIBLE };
  return value.length > LITERAL_SECRET_MAX ? { refusal: SECRET_TOO_LONG } : { value };
}

/** An API key: present, literal, and never a command, so a key reads the same everywhere. */
export function readApiKey(raw: string): ReadSecret {
  const value = raw.trim();
  if (!value) return { refusal: API_KEY_MISSING };
  return value.startsWith("!") ? { refusal: API_KEY_INVALID } : readLiteralSecret(value);
}
