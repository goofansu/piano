import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
/** Identity marker: Pi's ordinary project extension discovery must load this only with trust. */
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "phase0_project_marker",
    label: "Project resource marker",
    description: "Checkpoint identity marker",
    parameters: Type.Object({}),
    defaultActive: false,
    async execute() {
      return { content: [{ type: "text", text: "PHASE0_PROJECT_RESOURCE" }], details: undefined };
    },
  });
}
