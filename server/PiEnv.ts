/**
 * Resolve Pi's directories the same way the Pi CLI does, so piano lists the
 * same sessions the `pi --mode rpc` children read and write.
 *
 *   agent dir   : PI_CODING_AGENT_DIR, else ~/.pi/agent            (getAgentDir)
 *   session dir : PI_CODING_AGENT_SESSION_DIR, else the `sessionDir` setting,
 *                 else <agent dir>/sessions/<encoded cwd>/          (SessionManager default)
 */
import { homedir } from "node:os";
import { resolve } from "node:path";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

export function expandHome(p: string): string {
  return p.replace(/^~(?=$|\/)/, homedir());
}

/** The one spelling of a directory a caller names: home expanded, absolute, without a trailing slash. */
export function directoryPath(raw: string): string {
  return resolve(expandHome(raw));
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
