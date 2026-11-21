import { homedir } from "node:os";
import { resolve } from "node:path";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

export function expandHome(p: string): string {
  return p.replace(/^~(?=$|\/)/, homedir());
}

export function directoryPath(raw: string): string {
  return resolve(expandHome(raw));
}

export function agentDir(): string {
  return getAgentDir();
}

export function sessionDirFor(cwd: string): string | undefined {
  const env = process.env.PI_CODING_AGENT_SESSION_DIR;
  if (env) return resolve(cwd, expandHome(env));
  try {
    const configured = SettingsManager.create(cwd, getAgentDir()).getSessionDir();
    return configured ? resolve(cwd, expandHome(configured)) : undefined;
  } catch {
    return undefined;
  }
}
