export type FenceToken = [text: string, light: string, dark: string];
export type FenceLines = FenceToken[][];
export type FenceRequest = { id: number; code: string; lang: string };
export type FenceResponse = { id: number; lines?: FenceLines; unsupported?: boolean };

const MAX_CHARACTERS = 20_000;
const CACHE_SIZE = 200;

const resolved = new Map<string, FenceLines>();
const pending = new Map<string, Promise<FenceLines | undefined>>();
const waiting = new Map<number, (response: FenceResponse) => void>();
const unsupported = new Set<string>();
let worker: Worker | undefined;
let nextId = 0;

function connect(): Worker {
  const created = new Worker(new URL("./fenceHighlight.worker.ts", import.meta.url), {
    type: "module",
  });
  created.onmessage = (event: MessageEvent<FenceResponse>) => {
    waiting.get(event.data.id)?.(event.data);
    waiting.delete(event.data.id);
  };
  created.onerror = () => {
    for (const [id, settle] of waiting) settle({ id });
    waiting.clear();
    if (worker === created) worker = undefined;
    created.terminate();
  };
  return created;
}

function request(code: string, lang: string): Promise<FenceLines | undefined> {
  worker ??= connect();
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, (response) => {
      if (response.unsupported) unsupported.add(lang);
      resolve(response.lines && matches(response.lines, code) ? response.lines : undefined);
    });
    worker!.postMessage({ id, code, lang } satisfies FenceRequest);
  });
}

function matches(lines: FenceLines, code: string): boolean {
  return lines.map((line) => line.map(([text]) => text).join("")).join("\n") === code;
}

function cacheKey(code: string, lang: string): string | undefined {
  if (!lang || unsupported.has(lang) || !code.trim() || code.length > MAX_CHARACTERS)
    return undefined;
  return `${lang}\0${code}`;
}

function remember(key: string, lines: FenceLines) {
  resolved.delete(key);
  resolved.set(key, lines);
  if (resolved.size > CACHE_SIZE) resolved.delete(resolved.keys().next().value!);
}

export function highlightedFence(code: string, language: string): FenceLines | undefined {
  const key = cacheKey(code, language.toLowerCase());
  const lines = key === undefined ? undefined : resolved.get(key);
  if (key !== undefined && lines) remember(key, lines);
  return lines;
}

export async function highlightFence(
  code: string,
  language: string,
): Promise<FenceLines | undefined> {
  const lang = language.toLowerCase();
  const key = cacheKey(code, lang);
  if (key === undefined) return undefined;
  const found = resolved.get(key);
  if (found) return found;
  let task = pending.get(key);
  if (!task) {
    task = request(code, lang);
    pending.set(key, task);
  }
  const lines = await task;
  pending.delete(key);
  if (lines) remember(key, lines);
  return lines;
}
