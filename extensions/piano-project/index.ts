/** Bundled Pi extension: a Piano project's instructions in each run's system prompt. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PROJECT_INSTRUCTIONS_ENV, PROJECT_INSTRUCTIONS_SECTION } from "../../shared/dispatch.ts";

export default function pianoProject(pi: ExtensionAPI) {
  // The project's instructions, in a section of their own: Pi keeps the directory's
  // APPEND_SYSTEM.md, which its --append-system-prompt would replace.
  const instructions = process.env[PROJECT_INSTRUCTIONS_ENV];
  if (instructions)
    pi.on("before_agent_start", (event) => {
      event.systemPromptOptions.sections[PROJECT_INSTRUCTIONS_SECTION] = instructions;
    });
}
