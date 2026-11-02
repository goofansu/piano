/** Bundled Pi extension: save a skill or a prompt in Piano's own folders, after the user's Save. */
import { type JsonValue, Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DESCRIPTION_MAX, NAME_MAX, TEXT_MAX } from "../../shared/drafts.ts";
import { type LibraryKind, SAVE_PROMPT_TOOL, SAVE_SKILL_TOOL } from "../../shared/library.ts";
import { dispatchConfiguration } from "../piano-dispatch/NodeSocket.ts";
import { type LibraryDeps, type LibraryDraft, saveToLibrary } from "./LibrarySave.ts";

const draftFields = {
  name: Type.String({
    description: `Lowercase letters, numbers and single hyphens, at most ${NAME_MAX} characters`,
  }),
  description: Type.String({
    description: `What it is for and when to use it, at most ${DESCRIPTION_MAX} characters`,
  }),
  instructions: Type.String({ description: `Markdown body, at most ${TEXT_MAX} characters` }),
};
const SkillParameters = Type.Object({
  ...draftFields,
  disableModelInvocation: Type.Optional(
    Type.Boolean({
      description:
        "True loads the skill only when the user runs /skill:<name>. Omit to keep a saved skill's setting (false for a new one).",
    }),
  ),
});
const PromptParameters = Type.Object(draftFields);
const Output = Type.Object({
  status: Type.Union([Type.Literal("saved"), Type.Literal("cancelled"), Type.Literal("refused")]),
  kind: Type.Union([Type.Literal("skill"), Type.Literal("prompt")]),
  name: Type.String(),
  change: Type.Optional(Type.Union([Type.Literal("create"), Type.Literal("update")])),
  file: Type.Optional(Type.String()),
  reach: Type.Optional(Type.String()),
  field: Type.Optional(Type.String()),
  detail: Type.Optional(Type.String()),
});

const GUIDELINE =
  "piano_save_skill and piano_save_prompt save only after the user chooses Save in Piano. cancelled means the user declined or the run was stopped: nothing was written; do not ask again or save another way. refused names the field and the reason: fix it only if the user wants to. Never write Piano's skills or prompts folders with file tools.";

export default function pianoLibrary(pi: ExtensionAPI) {
  const config = dispatchConfiguration();
  // Not advertised without the Piano that started this Pi: a catalog probe, a terminal Pi.
  if (!config) return;
  const base = new URL(config.url);
  base.protocol = base.protocol === "wss:" ? "https:" : "http:";
  base.pathname = "/";
  const request: LibraryDeps["request"] = (path, init) =>
    fetch(new URL(path, base), {
      ...init,
      headers: { ...(init.headers as Record<string, string>), origin: config.origin },
    });

  const register = (kind: LibraryKind) =>
    defineTool({
      name: kind === "skill" ? SAVE_SKILL_TOOL : SAVE_PROMPT_TOOL,
      label: kind === "skill" ? "Save skill" : "Save prompt",
      promptSnippet:
        kind === "skill"
          ? "Create or update a skill in Piano, after the user approves"
          : "Create or update a /prompt in Piano, after the user approves",
      promptGuidelines: [GUIDELINE],
      description:
        kind === "skill"
          ? "Propose a skill for Piano's skills folder, which every session Piano starts from now loads. Piano shows the user the SKILL.md it would save (a diff when a skill Piano created has that name) and saves only on their Save. To change a skill, read its SKILL.md first and send the whole new content. Returns status saved (with where it applies, to tell the user), cancelled (nothing written) or refused (field and detail)."
          : "Propose a prompt template (/name) for Piano's prompts folder, which every session Piano starts from now loads. Piano shows the user the file it would save (a diff when a prompt Piano created has that name) and saves only on their Save. instructions is the template body; $1 and $@ are argument placeholders. Returns status saved (with where it applies, to tell the user), cancelled (nothing written) or refused (field and detail).",
      parameters: kind === "skill" ? SkillParameters : PromptParameters,
      outputSchema: Output,
      executionMode: "sequential",
      async execute(_id, params: LibraryDraft, signal, _update, ctx) {
        if (!ctx.hasUI) throw new Error("Saving needs Piano's interactive UI.");
        const result = await saveToLibrary(
          kind,
          params,
          {
            request,
            confirm: (title, message, abort) => ctx.ui.confirm(title, message, { signal: abort }),
          },
          signal,
        );
        const text = JSON.stringify(result);
        return {
          content: [{ type: "text" as const, text }],
          details: result,
          structuredContent: JSON.parse(text) as JsonValue,
        };
      },
    });
  pi.registerTool(register("skill"));
  pi.registerTool(register("prompt"));
}
