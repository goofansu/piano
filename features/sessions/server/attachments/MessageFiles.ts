import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Effect } from "effect";
import { agentDir, directoryPath } from "../../../../server/shared/PiEnv.ts";
import { TEXT_TYPE } from "../../../../shared/session/attachments.ts";
import type { FileAttachment } from "../../../../shared/wire.ts";

const sessionFiles = (cwd: string, sessionId: string) =>
  join(
    agentDir(),
    "piano-attachments",
    createHash("sha256")
      .update(JSON.stringify([directoryPath(cwd), sessionId]))
      .digest("hex"),
  );

export const saveMessageFiles = (
  cwd: string,
  sessionId: string,
  files: readonly FileAttachment[],
) =>
  Effect.tryPromise(async () => {
    const directory = sessionFiles(cwd, sessionId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const message = await mkdtemp(join(directory, "message-"));
    try {
      const paths: string[] = [];
      for (const [index, file] of files.entries()) {
        const safeName = file.name.replace(/[^A-Za-z0-9_.-]+/g, "-");
        const extension = extname(safeName);
        const stem = safeName.slice(0, safeName.length - extension.length);
        const suffix = file.mimeType === TEXT_TYPE ? extension : extension.toLowerCase();
        const name = `${stem.slice(0, 120) || "attachment"}${suffix.slice(0, 24)}`;
        const path = join(message, `${index + 1}-${name}`);
        await writeFile(path, Buffer.from(file.data, "base64"), { mode: 0o600, flag: "wx" });
        paths.push(path);
      }
      return paths;
    } catch (error) {
      await rm(message, { recursive: true, force: true });
      throw error;
    }
  });

export const removeSessionMessageFiles = (cwd: string, sessionId: string) =>
  Effect.tryPromise(() => rm(sessionFiles(cwd, sessionId), { recursive: true, force: true }));
