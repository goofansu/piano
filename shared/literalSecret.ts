export const LITERAL_SECRET_MAX = 8192;

export const SECRET_NOT_VISIBLE = "Use only visible ASCII characters, without spaces.";
export const API_KEY_INVALID = "Enter a valid API key, not a command.";
export const API_KEY_MISSING = "Enter an API key.";
export const SECRET_TOO_LONG = `Use at most ${LITERAL_SECRET_MAX} characters.`;

export type ReadSecret =
  | { readonly value: string; readonly refusal?: undefined }
  | { readonly refusal: string };

export function readLiteralSecret(raw: string): ReadSecret {
  const value = raw.trim();
  if (/[^\x21-\x7e]/.test(value) || (raw && !value)) return { refusal: SECRET_NOT_VISIBLE };
  return value.length > LITERAL_SECRET_MAX ? { refusal: SECRET_TOO_LONG } : { value };
}

export function readApiKey(raw: string): ReadSecret {
  const value = raw.trim();
  if (!value) return { refusal: API_KEY_MISSING };
  return value.startsWith("!") ? { refusal: API_KEY_INVALID } : readLiteralSecret(value);
}
