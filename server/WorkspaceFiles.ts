import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Data, Effect } from "effect";
import type { Workspace } from "../shared/wire.ts";

class FileRefusal extends Data.TaggedError("FileRefusal")<{ readonly detail: string }> {}
const refuse = (detail: string): never => {
  throw new FileRefusal({ detail });
};
const limit = 1024 * 1024;
const within = (root: string, path: string) => {
  const name = relative(root, path);
  return name !== ".." && !name.startsWith(`..${sep}`) && !isAbsolute(name);
};

/** Explicit workspace-only reads; no directory traversal, listing, or fallback to another cwd. */
export const readWorkspaceFile = Effect.fn("WorkspaceFiles.read")(function* (
  workspace: Workspace,
  path: string,
) {
  return yield* Effect.tryPromise({
    try: async () => {
      const root = await realpath(workspace.path);
      const requested = resolve(workspace.path, path);
      if (!path.trim() || path.includes("\0") || !within(resolve(workspace.path), requested))
        refuse("Choose a file inside this workspace.");
      const target = await realpath(requested);
      if (!within(root, target))
        refuse("Choose a file inside this workspace; this link points outside it.");
      // Nonblocking prevents special files (notably FIFOs) from hanging the request.
      const file = await open(
        target,
        constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
      );
      try {
        const stat = await file.stat();
        if (!stat.isFile()) refuse("Choose a regular text file, not a directory or device.");
        if (stat.size > limit) refuse("This file is too large. Choose a text file up to 1 MiB.");
        const bytes = Buffer.alloc(limit + 1);
        let length = 0;
        while (length < bytes.length) {
          const result = await file.read(bytes, length, bytes.length - length, null);
          if (!result.bytesRead) break;
          length += result.bytesRead;
        }
        if (length > limit) refuse("This file is too large. Choose a text file up to 1 MiB.");
        const data = bytes.subarray(0, length);
        if (data.includes(0)) refuse("This file is not supported. Choose a UTF-8 text file.");
        let content: string;
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(data);
        } catch {
          return refuse("This file is not supported. Choose a UTF-8 text file.");
        }
        return { path: relative(resolve(workspace.path), requested), content };
      } finally {
        await file.close();
      }
    },
    catch: (error) =>
      error instanceof FileRefusal
        ? error
        : new FileRefusal({
            detail:
              "Could not read this file. Check the path and read permissions in this workspace.",
          }),
  });
});
