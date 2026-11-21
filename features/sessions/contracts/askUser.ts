import { arr, compile, obj, opt, str } from "@earendil-works/pi-schema";

export const ASK_USER_TOOL = "ask_user";

export interface AskUserQuestion {
  readonly id: string;
  readonly question: string;
  readonly options?: readonly string[];
}

export type AskUserPrompt =
  | { readonly method: "select"; readonly title: string; readonly options: readonly string[] }
  | { readonly method: "editor"; readonly title: string };

export interface AskUserResult {
  readonly status: "answered" | "cancelled";
  readonly answers: Readonly<Record<string, string>>;
}

export interface AskUserOutcome {
  readonly status: AskUserResult["status"];
  readonly items: ReadonlyArray<AskUserQuestion & { readonly answer?: string }>;
}

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export const AskUserParameters = obj({
  questions: arr(
    obj({
      id: str({ minLength: 1, description: "Unique ID used to key this question's answer" }),
      question: str({
        minLength: 1,
        description:
          "Rendered as Markdown. Lead with the question itself: one short line ending in ?. Then a blank line and a bullet list of context, one fact per bullet (a candidate, a `path` in backticks, a count); no paragraphs. Keep the whole question a few hundred characters at most, so it reads on a phone.",
      }),
      options: opt(
        arr(str({ minLength: 1 }), {
          minItems: 1,
          uniqueItems: true,
          description:
            "Choices for a single selection, one short line each; put reasoning in the question's bullets, not here. Omit for a free-text answer.",
        }),
      ),
    }),
    {
      minItems: 1,
      description: "Questions in presentation order; use one item for a single question",
    },
  ),
});

const parameters = compile(AskUserParameters, { coerce: true });

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

export function askUserPrompt(
  questions: ReadonlyArray<AskUserQuestion>,
  index: number,
): AskUserPrompt {
  const { question, options } = questions[index];
  const title =
    questions.length > 1 ? `${index + 1} of ${questions.length}: ${question}` : question;
  return options ? { method: "select", title, options } : { method: "editor", title };
}

export function askUserResult(value: unknown): AskUserResult | undefined {
  const result = recordOf(value);
  const answers = recordOf(result?.answers);
  if (!answers || (result?.status !== "answered" && result?.status !== "cancelled")) return;
  if (Object.values(answers).some((answer) => typeof answer !== "string")) return;
  return { status: result.status, answers: answers as Record<string, string> };
}

export function storedAskUserResult(result: unknown): AskUserResult | undefined {
  const { details, content } = recordOf(result) ?? {};
  return askUserResult(details ?? firstText(content));
}

export function answerStored(result: unknown, questionId: string, value: string): boolean {
  const answers = storedAskUserResult(result)?.answers;
  return (
    answers !== undefined && Object.hasOwn(answers, questionId) && answers[questionId] === value
  );
}

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
