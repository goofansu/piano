import { cn } from "cn";
import { Markdown } from "@/shared/markdown/Markdown";

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
