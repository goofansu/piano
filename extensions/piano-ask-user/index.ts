import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { map, obj, type Static, str } from "@earendil-works/pi-schema";
import {
  ASK_USER_TOOL,
  AskUserParameters,
  askUserPrompt,
  askUserQuestions,
} from "../../shared/features/sessions/askUser.ts";

const Output = obj({ status: StringEnum(["answered", "cancelled"] as const), answers: map(str()) });

export default function pianoAskUser(pi: ExtensionAPI) {
  pi.registerTool(
    defineTool({
      name: ASK_USER_TOOL,
      label: "Ask user",
      promptSnippet: "Ask the user questions and wait for their answers",
      promptGuidelines: [
        "Use ask_user when you need user decisions or missing information to proceed. Batch independent questions; wait for answers before asking dependent questions. Cancellation ends the batch and returns only answers already submitted; it is not an answer or approval for unanswered questions. Do not automatically ask again.",
      ],
      description:
        "Ask questions sequentially in Piano's inline form, with no model turns between them. Supply a non-empty questions array with unique IDs, including for a single question. Each item has a question and optional options for a single choice; omit options for multiline free text. Returns answers keyed by ID and status answered when all are submitted, or cancelled with partial answers when the batch ends early. Each question renders as Markdown: shape it as the question parameter describes. Do not use this as a substitute for required permission or approval mechanisms.",
      parameters: AskUserParameters,
      outputSchema: Output,
      executionMode: "sequential",
      async execute(_id, { questions }: Static<typeof AskUserParameters>, signal, _update, ctx) {
        if (!questions.length) throw new Error("At least one question is required.");
        if (!askUserQuestions({ questions }))
          throw new Error(
            "Question IDs, questions and choices must not be blank, and IDs must be unique.",
          );
        if (!ctx.hasUI) throw new Error("ask_user requires an interactive UI.");
        const answers: Array<[string, string]> = [];
        for (const [index, { id }] of questions.entries()) {
          if (signal?.aborted) break;
          const prompt = askUserPrompt(questions, index);
          const answer =
            prompt.method === "select"
              ? await ctx.ui.select(prompt.title, [...prompt.options], { signal })
              : await ctx.ui.editor(prompt.title);
          if (signal?.aborted || answer === undefined) break;
          answers.push([id, answer]);
        }
        const result: Static<typeof Output> = {
          status: answers.length === questions.length ? "answered" : "cancelled",
          answers: Object.fromEntries(answers),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
          structuredContent: result,
        };
      },
    }),
  );
}
