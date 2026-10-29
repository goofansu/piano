/** Piano's ask_user tool as the server sees it: its name, and the answers its persisted result holds.
 * The extension owns the tool; this is the one fact the server reads from Pi's native tool result. */

export const ASK_USER_TOOL = "ask_user";

/** The batch result Pi stores for a finished `ask_user` call, from a `tool_execution_end` record:
 * `details` first, else the JSON text content. Undefined when the record is not that shape. */
export function askUserAnswers(result: unknown): Record<string, string> | undefined {
  if (!result || typeof result !== "object") return;
  const { details, content } = result as { details?: unknown; content?: unknown };
  const parsed = details ?? firstText(content);
  if (!parsed || typeof parsed !== "object") return;
  const { answers } = parsed as { answers?: unknown };
  if (!answers || typeof answers !== "object") return;
  return Object.fromEntries(
    Object.entries(answers).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** True when the batch result holds `value`: the tool stores answers in presentation order and
 * cancellation ends the batch, so an answer present for any question proves every earlier one. */
export function answerStored(result: unknown, value: string): boolean {
  const answers = askUserAnswers(result);
  return answers !== undefined && Object.values(answers).includes(value);
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
