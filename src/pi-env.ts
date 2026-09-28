/**
 * Resolve pi's directories the same way the pi CLI does, so piano lists the
 * same sessions the `pi --mode rpc` children read and write.
 *
 *   agent dir   : PI_CODING_AGENT_DIR, else ~/.pi/agent          (getAgentDir)
 *   session dir : PI_CODING_AGENT_SESSION_DIR, else the `sessionDir` setting,
 *                 else <agent dir>/sessions/<encoded cwd>/        (SessionManager default)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

export function expandHome(p: string): string {
  return p.replace(/^~(?=$|\/)/, homedir());
}

export function agentDir(): string {
  return getAgentDir();
}

export function sessionDirFor(cwd: string): string | undefined {
  const env = process.env.PI_CODING_AGENT_SESSION_DIR;
  if (env) return expandHome(env);
  try {
    const configured = SettingsManager.create(cwd, getAgentDir()).getSessionDir();
    return configured ? expandHome(configured) : undefined;
  } catch {
    return undefined;
  }
}

export function enabledModelPatterns(cwd: string): string[] {
  try {
    return SettingsManager.create(cwd, getAgentDir()).getEnabledModels() ?? [];
  } catch {
    return [];
  }
}

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Entry point of the pi CLI spawned for every thread. */
export const PI_CLI =
  process.env.PIANO_PI_CLI ?? join(ROOT, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");

/** Extra arguments appended to every spawned `pi` (e.g. "-e ./ext.ts --thinking high"). */
export const PI_EXTRA_ARGS: string[] = (process.env.PIANO_PI_ARGS ?? "").split(/\s+/).filter(Boolean);
