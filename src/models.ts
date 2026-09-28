/**
 * Model catalog for the picker. A short-lived `pi --mode rpc --no-session`
 * probe reports the models pi can actually use (credentials resolved) and the
 * model pi would pick by default. The `enabledModels` setting marks the user's
 * preferred subset, which the picker lists first.
 */
import { homedir } from "node:os";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { enabledModelPatterns, PI_CLI, PI_EXTRA_ARGS } from "./pi-env.ts";

export interface ModelChoice {
  ref: string; // provider/id
  provider: string;
  id: string;
  name?: string;
  reasoning: boolean;
  contextWindow: number;
  enabled: boolean;
}

export interface ModelCatalog {
  models: ModelChoice[];
  defaultModel?: string;
  defaultThinkingLevel?: string;
  fetchedAt: string;
  error?: string;
}

function patternMatcher(patterns: string[]): (ref: string, id: string) => boolean {
  const tests = patterns.map((p) => {
    const lowered = p.toLowerCase();
    if (lowered.includes("*")) {
      const re = new RegExp(`^${lowered.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
      return (ref: string, id: string) => re.test(ref) || re.test(id);
    }
    return (ref: string, id: string) => ref === lowered || id === lowered;
  });
  return (ref, id) => tests.some((t) => t(ref.toLowerCase(), id.toLowerCase()));
}

export async function loadModelCatalog(cwd = homedir()): Promise<ModelCatalog> {
  const client = new RpcClient({ cliPath: PI_CLI, cwd, args: ["--no-session", ...PI_EXTRA_ARGS] });
  try {
    await client.start();
    const [models, state] = await Promise.all([client.getAvailableModels(), client.getState()]);
    const isEnabled = patternMatcher(enabledModelPatterns(cwd));
    const choices: ModelChoice[] = models.map((m) => {
      const ref = `${m.provider}/${m.id}`;
      return {
        ref,
        provider: m.provider,
        id: m.id,
        name: (m as { name?: string }).name,
        reasoning: !!m.reasoning,
        contextWindow: m.contextWindow,
        enabled: isEnabled(ref, m.id),
      };
    });
    choices.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.ref.localeCompare(b.ref));
    return {
      models: choices,
      defaultModel: state.model ? `${state.model.provider}/${state.model.id}` : undefined,
      defaultThinkingLevel: state.thinkingLevel,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      models: [],
      fetchedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await client.stop().catch(() => undefined);
  }
}
