/** Piano's ask_user tool as Piano reads it from Pi's records: its name, the questions a call asks,
 * the dialog it raises for each and the batch result Pi stores. The extension owns the tool and
 * asks through `askUserPrompt`; this is the one reader of its arguments, dialogs and result, for
 * the server's answer receipts and the browser's transcript alike. */
import { arr, compile, obj, opt, str } from "@earendil-works/pi-schema";

export const ASK_USER_TOOL = "ask_user";

export interface AskUserQuestion {
  readonly id: string;
  readonly question: string;
  /** Choices for a single selection; absent for a free-text answer. */
  readonly options?: readonly string[];
}

/** The dialog the tool raises for one question: Pi's `select` with its choices, else `editor`. */
export type AskUserPrompt =
  | { readonly method: "select"; readonly title: string; readonly options: readonly string[] }
  | { readonly method: "editor"; readonly title: string };

/** The batch result the tool returns: every answer is keyed by its question ID. */
export interface AskUserResult {
  readonly status: "answered" | "cancelled";
  readonly answers: Readonly<Record<string, string>>;
}

/** A finished call's questions in presentation order, each with its stored answer, if any. */
export interface AskUserOutcome {
  readonly status: AskUserResult["status"];
  readonly items: ReadonlyArray<AskUserQuestion & { readonly answer?: string }>;
}

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** The tool's parameters, as Pi declares them to the model and validates each call against. */
export const AskUserParameters = obj({
  questions: arr(
    obj({
      id: str({ minLength: 1, description: "Unique ID used to key this question's answer" }),
      question: str({ minLength: 1, description: "Question, including essential context" }),
      options: opt(
        arr(str({ minLength: 1 }), {
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

/** Pi's own reading of a call: it compiles a tool's parameters with coercion and parses each call
 * before the tool runs. Pi also passes string formats and rejects dangling `$ref`s, neither of
 * which these parameters have. */
const parameters = compile(AskUserParameters, { coerce: true });

/** A call's questions, from its raw or converted arguments, read as Pi reads them: Pi's records
 * keep the model's raw arguments, so `id: 1` is announced as a number but asked and stored as "1",
 * `options: null` drops the choices and a lone choice becomes a list of one. Undefined for a call
 * Pi rejects, or unless every ID, question and choice is non-blank and every ID unique: the one rule
 * the tool checks before asking anything. */
export function askUserQuestions(args: unknown): AskUserQuestion[] | undefined {
  const parsed = parameters.parse(args);
  if (!parsed.ok) return;
  const ids = new Set<string>();
  for (const { id, question, options } of parsed.value.questions) {
    if (!id.trim() || !question.trim() || ids.has(id)) return;
    if (options?.some((option) => !option.trim())) return;
    ids.add(id);
  }
  return parsed.value.questions;
}

/** The dialog the tool raises for `questions[index]`: numbered `1 of 3: …` in a batch, the bare
 * question when it asks one. The extension asks through this, so the server can tell the call's
 * own question from another dialog opened while it runs. */
export function askUserPrompt(
  questions: ReadonlyArray<AskUserQuestion>,
  index: number,
): AskUserPrompt {
  const { question, options } = questions[index];
  const title =
    questions.length > 1 ? `${index + 1} of ${questions.length}: ${question}` : question;
  return options ? { method: "select", title, options } : { method: "editor", title };
}

/** The tool's result object; undefined unless it has a known status and only string answers. */
export function askUserResult(value: unknown): AskUserResult | undefined {
  const result = recordOf(value);
  const answers = recordOf(result?.answers);
  if (!answers || (result?.status !== "answered" && result?.status !== "cancelled")) return;
  if (Object.values(answers).some((answer) => typeof answer !== "string")) return;
  return { status: result.status, answers: answers as Record<string, string> };
}

/** The result Pi stores for a finished call, from a `tool_execution_end` record's `result`:
 * `details` first, else the JSON text content. */
export function storedAskUserResult(result: unknown): AskUserResult | undefined {
  const { details, content } = recordOf(result) ?? {};
  return askUserResult(details ?? firstText(content));
}

/** True when the stored result holds `value` as the answer to the question `questionId`. */
export function answerStored(result: unknown, questionId: string, value: string): boolean {
  const answers = storedAskUserResult(result)?.answers;
  return (
    answers !== undefined && Object.hasOwn(answers, questionId) && answers[questionId] === value
  );
}

/** Pairs a finished call's questions with its result. Undefined when they do not match: an answer
 * for no question, or an `answered` batch missing one. */
export function askUserOutcome(args: unknown, result: unknown): AskUserOutcome | undefined {
  const questions = askUserQuestions(args);
  const batch = askUserResult(result);
  if (!questions || !batch) return;
  const ids = new Set(questions.map(({ id }) => id));
  if (Object.keys(batch.answers).some((id) => !ids.has(id))) return;
  const items: AskUserOutcome["items"][number][] = [];
  for (const { id, question } of questions) {
    if (Object.hasOwn(batch.answers, id)) items.push({ id, question, answer: batch.answers[id] });
    else if (batch.status === "answered") return;
    else items.push({ id, question });
  }
  return { status: batch.status, items };
}

function firstText(content: unknown): unknown {
  if (!Array.isArray(content)) return;
  const text = content.find((block) => block && typeof block === "object" && block.type === "text");
  if (!text || typeof text.text !== "string") return;
  try {
    return JSON.parse(text.text);
  } catch {
    return;
  }
}
