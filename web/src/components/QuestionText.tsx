import { cn } from "cn";
import { Markdown } from "@/components/Markdown";

/** A question's text as the asking and answered views show it: Markdown in the transcript's prose,
 * keeping the single line breaks a model writes between `Field: value` lines, which Markdown
 * alone would join into one paragraph. */
export function QuestionText({
  id,
  text,
  className,
}: {
  id?: string;
  text: string;
  className?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "min-w-0 text-sm [&_li]:whitespace-pre-line [&_p]:whitespace-pre-line [&_td]:whitespace-pre-line",
        className,
      )}
    >
      <Markdown text={text} mode="static" diagrams={false} className="prose-chat" />
    </div>
  );
}
