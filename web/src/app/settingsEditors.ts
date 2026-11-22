import type { EditorPage } from "../../../features/commands/web/index.ts";
import type { McpServerSetup } from "../../../features/mcp/contracts/mcp.ts";
import type { Webhook } from "../../../features/webhooks/contracts/webhooks.ts";
import { pageEditor } from "../shared/lib/pageEditor.ts";

export const PAGE_EDITORS = {
  webhooks: pageEditor<Webhook>(),
  mcp: pageEditor<McpServerSetup>(),
  skills: pageEditor<never>(),
  prompts: pageEditor<never>(),
} satisfies Record<EditorPage, { open: (target: "new") => void }>;

export const openPageEditor = (page: EditorPage) => PAGE_EDITORS[page].open("new");
export const editorAvailable = (page: EditorPage) => PAGE_EDITORS[page].available();
const editors = Object.values(PAGE_EDITORS);

export const pageAvailability = {
  subscribe: (listener: () => void) => {
    const stops = editors.map((editor) => editor.subscribe(listener));
    return () => {
      for (const stop of stops) stop();
    };
  },
  getState: () => editors.map((editor) => (editor.available() ? "1" : "0")).join(""),
};
