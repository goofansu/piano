/** Recognize the built-in command, not /loginSomething or text mentioning it. */
export function loginProvider(text: string): string | null {
  const match = /^\s*\/login(?:\s+([\s\S]*))?$/.exec(text.trimEnd());
  return match ? (match[1] ?? "").trim().toLowerCase() : null;
}
