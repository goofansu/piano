#!/usr/bin/env node
// Session client, or read-only/explicit legacy-stop recovery without an owner.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { PreviewAdapter, type PreviewConfig, type PreviewRequest } from "./PreviewAdapter.ts";
import { ownerRequest } from "./PreviewClient.ts";

process.umask(0o077);
try {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 65536) throw new Error("Preview request exceeds 64 KiB.");
  }
  const request: PreviewRequest = JSON.parse(input);
  const config: PreviewConfig = process.env.PIANO_PREVIEW_CONFIG
    ? JSON.parse(await readFile(process.env.PIANO_PREVIEW_CONFIG, "utf8"))
    : {};
  const root = process.env.PIANO_PREVIEW_STATE ?? join(homedir(), ".local/state/piano/previews");
  console.log(
    process.env.PIANO_PREVIEW_OWNER
      ? await ownerRequest(process.env.PIANO_PREVIEW_OWNER, request)
      : JSON.stringify(await new PreviewAdapter().request(request, root, config)),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      error: error instanceof Error ? error.message.slice(-6000) : String(error).slice(-6000),
    }),
  );
  process.exitCode = 1;
}
