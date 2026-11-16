import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "phase0_project_marker",
    label: "Project resource marker",
    description: "Checkpoint identity marker",
    parameters: { type: "object", properties: {} },
    defaultActive: false,
    async execute() {
      return { content: [{ type: "text", text: "PHASE0_PROJECT_RESOURCE" }], details: undefined };
    },
  });
}
