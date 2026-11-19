import { constants } from "node:fs";
import { open } from "node:fs/promises";

export type LocalFileRefusalReason = "not-file" | "too-large" | "changed" | "aborted";

export class LocalFileRefusal extends Error {
  readonly reason: LocalFileRefusalReason;
  constructor(reason: LocalFileRefusalReason) {
    super(`Local file read refused: ${reason}`);
    this.name = "LocalFileRefusal";
    this.reason = reason;
  }
}

export interface LocalFile {
  readonly prefix: (bytes: number) => Promise<Buffer>;
  readonly whole: (limit: number, signal?: AbortSignal) => Promise<Buffer>;
  readonly close: () => Promise<void>;
}

export interface LocalFileOptions {
  readonly noFollow?: boolean;
}

const checkAborted = (signal: AbortSignal | undefined) => {
  try {
    signal?.throwIfAborted();
  } catch {
    throw new LocalFileRefusal("aborted");
  }
};

export async function openLocalFile(
  path: string,
  options: LocalFileOptions = {},
): Promise<LocalFile> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NONBLOCK | (options.noFollow ? constants.O_NOFOLLOW : 0),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new LocalFileRefusal("not-file");
    const size = stat.size;
    return {
      prefix: async (bytes) => {
        const buffer = Buffer.alloc(bytes);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead);
      },
      whole: async (limit, signal) => {
        checkAborted(signal);
        if (size > limit) throw new LocalFileRefusal("too-large");
        const bytes = Buffer.alloc(size + 1);
        let length = 0;
        while (length < bytes.length) {
          checkAborted(signal);
          const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length > limit) throw new LocalFileRefusal("too-large");
        if (length !== size) throw new LocalFileRefusal("changed");
        return bytes.subarray(0, length);
      },
      close: () => handle.close(),
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function readLocalFile(
  path: string,
  options: LocalFileOptions & { readonly limit: number; readonly signal?: AbortSignal },
): Promise<Buffer> {
  checkAborted(options.signal);
  const file = await openLocalFile(path, options);
  let bytes: Buffer;
  try {
    bytes = await file.whole(options.limit, options.signal);
  } finally {
    await file.close();
  }
  checkAborted(options.signal);
  return bytes;
}
