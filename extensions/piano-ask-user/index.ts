/** Model-initiated questions through Pi's supported dialogs; Piano owns the answer surface. */
import { type Static, Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const Parameters = Type.Object({
  question: Type.String({ minLength: 1, description: "One question, including essential context" }),
  options: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      uniqueItems: true,
      description: "Choices for a single selection; omit for a free-text answer",
    }),
  ),
});
const Output = Type.Union([
  Type.Object({ status: Type.Literal("answered"), answer: Type.String() }),
  Type.Object({ status: Type.Literal("cancelled") }),
]);

export default function pianoAskUser(pi: ExtensionAPI) {
  pi.registerTool(
    defineTool({
      name: "ask_user",
      label: "Ask user",
      promptSnippet: "Ask the user a question and wait for their answer",
      promptGuidelines: [
        "Use ask_user when you need a user decision or missing information to proceed. Ask one question per call. Cancellation is not an answer or approval; do not automatically ask again.",
      ],
      description:
        "Ask the user one question in Piano's inline form and wait for their reply. Supply options for a single choice, or omit options for multiline free text. Returns the exact answer or an explicit cancelled status. Include essential context in the question. Do not use this as a substitute for required permission or approval mechanisms.",
      parameters: Parameters,
      outputSchema: Output,
      executionMode: "sequential",
      async execute(_id, { question, options }, signal, _update, ctx) {
        if (!question.trim() || options?.some((option) => !option.trim()))
          throw new Error("Questions and choices must not be blank.");
        if (!ctx.hasUI) throw new Error("ask_user requires an interactive UI.");
        let answer: string | undefined;
        if (!signal?.aborted) {
          answer = options
            ? await ctx.ui.select(question, options, { signal })
            : await ctx.ui.editor(question);
        }
        // editor has no signal option. Piano's Stop/Abort cancels pending dialogs (INV-04);
        // a reply racing abort must never become an answer to an already-cancelled call.
        const result: Static<typeof Output> =
          signal?.aborted || answer === undefined
            ? { status: "cancelled" }
            : { status: "answered", answer };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
          structuredContent: result,
        };
      },
    }),
  );
}
