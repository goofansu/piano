/** Piano's ask_user tool as Piano reads it from Pi's records: its name, the questions a call asks
 * and the batch result Pi stores. The extension owns the tool; this is the one reader of its
 * arguments and result, for the server's answer receipts and the browser's transcript alike. */

export const ASK_USER_TOOL = "ask_user";

export interface AskUserQuestion {
  readonly id: string;
  readonly question: string;
}

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

/** A string field as Pi converts it before the tool runs (TypeBox `Value.Convert`): Pi's records
 * keep the model's raw arguments, so `id: 1` is announced as a number but asked and stored as "1". */
const asText = (value: unknown): string | undefined =>
  typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean" || value === null
      ? String(value)
      : value === undefined
        ? ""
        : undefined;

/** A call's questions, from its raw or converted arguments; undefined unless every ID and question
 * is non-blank and every ID unique, the rule the tool checks before asking anything. */
export function askUserQuestions(args: unknown): AskUserQuestion[] | undefined {
  const questions = recordOf(args)?.questions;
  if (!Array.isArray(questions) || !questions.length) return;
  const ids = new Set<string>();
  const items: AskUserQuestion[] = [];
  for (const value of questions) {
    const fields = recordOf(value);
    if (!fields) return;
    const id = asText(fields.id);
    const question = asText(fields.question);
    if (id === undefined || question === undefined) return;
    if (!id.trim() || !question.trim() || ids.has(id)) return;
    ids.add(id);
    items.push({ id, question });
  }
  return items;
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
