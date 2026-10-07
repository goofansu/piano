import { commandMatch } from "@/lib/commandMatch";

/** Highlight the best fuzzy alignment without changing the text or its accessible name. */
export function MatchText({ text, search, indices }: { text: string; search?: string; indices?: number[] }) {
  const matched = new Set(indices ?? commandMatch(text, search ?? "").indices);
  const parts: { text: string; matched: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = matched.has(i);
    const previous = parts.at(-1);
    if (previous?.matched === hit) previous.text += text[i];
    else parts.push({ text: text[i], matched: hit });
  }
  return <>{parts.map((part, i) => part.matched
    ? <mark key={i} className="rounded-sm bg-accent text-accent-foreground font-semibold">{part.text}</mark>
    : part.text)}</>;
}
