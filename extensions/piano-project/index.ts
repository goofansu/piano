import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PROJECT_INSTRUCTIONS_ENV, PROJECT_INSTRUCTIONS_SECTION } from "../../shared/dispatch.ts";

export default function pianoProject(pi: ExtensionAPI) {
  const instructions = process.env[PROJECT_INSTRUCTIONS_ENV];
  if (instructions)
    pi.on("before_agent_start", (event) => {
      event.systemPromptOptions.sections[PROJECT_INSTRUCTIONS_SECTION] = instructions;
    });
}
