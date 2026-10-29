/** Model-initiated questions through Pi's supported dialogs; Piano owns the answer surface. */
import { type Static, Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ASK_USER_TOOL } from "../../shared/askUser.ts";

const Parameters = Type.Object({
  questions: Type.Array(
    Type.Object({
      id: Type.String({
        minLength: 1,
        description: "Unique ID used to key this question's answer",
      }),
      question: Type.String({ minLength: 1, description: "Question, including essential context" }),
      options: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), {
          minItems: 1,
          uniqueItems: true,
          description: "Choices for a single selection; omit for a free-text answer",
        }),
      ),
    }),
    {
      minItems: 1,
      description: "Questions in presentation order; use one item for a single question",
    },
  ),
});
const Output = Type.Object({
  status: Type.Union([Type.Literal("answered"), Type.Literal("cancelled")]),
  answers: Type.Record(Type.String(), Type.String()),
});

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
        "Ask questions sequentially in Piano's inline form, with no model turns between them. Supply a non-empty questions array with unique IDs, including for a single question. Each item has a question and optional options for a single choice; omit options for multiline free text. Returns answers keyed by ID and status answered when all are submitted, or cancelled with partial answers when the batch ends early. Include essential context in each question. Do not use this as a substitute for required permission or approval mechanisms.",
      parameters: Parameters,
      outputSchema: Output,
      executionMode: "sequential",
      async execute(_id, { questions }, signal, _update, ctx) {
        // Validate the entire batch before collecting any answers: IDs must never overwrite one another.
        if (!questions.length) throw new Error("At least one question is required.");
        const ids = new Set<string>();
        for (const { id, question, options } of questions) {
          if (!id.trim() || !question.trim() || options?.some((option) => !option.trim()))
            throw new Error("Question IDs, questions and choices must not be blank.");
          if (ids.has(id)) throw new Error("Question IDs must be unique.");
          ids.add(id);
        }
        if (!ctx.hasUI) throw new Error("ask_user requires an interactive UI.");
        const answers: Array<[string, string]> = [];
        for (const [index, { id, question, options }] of questions.entries()) {
          if (signal?.aborted) break;
          const title =
            questions.length > 1 ? `${index + 1} of ${questions.length}: ${question}` : question;
          const answer = options
            ? await ctx.ui.select(title, options, { signal })
            : await ctx.ui.editor(title);
          // editor has no signal option. Piano's Stop/Abort cancels pending dialogs (INV-04);
          // never accept a reply racing abort or open the remaining questions after cancellation.
          if (signal?.aborted || answer === undefined) break;
          answers.push([id, answer]);
        }
        const result: Static<typeof Output> = {
          status: answers.length === questions.length ? "answered" : "cancelled",
          // fromEntries keeps IDs such as __proto__ as own data properties, not setters.
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
