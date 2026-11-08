import { CheckIcon, CopyIcon } from "lucide-react";
import { type ComponentProps, useEffect, useState } from "react";
import { toast } from "sonner";
import { IconButton } from "@/components/IconButton";

/** How long a copy control confirms the copy before it offers to copy again. */
const CONFIRMED_MS = 2000;

/**
 * Writes `text` to the clipboard; a refusal toasts `failure`. Resolves whether the clipboard took
 * it. Every copy in Piano goes through here: a control through `useCopy`, which confirms in place;
 * a command, which has no control to flip, toasts its own success when this resolves `true`.
 */
export async function copyText(text: string, failure: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toast.error(failure);
    return false;
  }
}

/**
 * Copies `text` on `copy()`: `copied` holds for two seconds after the clipboard takes it; a
 * refused copy clears it and toasts `failure`. Every copy control decides through this.
 */
export function useCopy(text: string, failure: string) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), CONFIRMED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => setCopied(await copyText(text, failure));
  return { copied, copy };
}

/** Copies `text`, its icon turning to a check while the copy is confirmed. */
export function CopyButton({
  text,
  label,
  copiedLabel,
  failure,
  variant,
  size = "inline",
  className,
}: {
  text: string;
  label: string;
  copiedLabel: string;
  /** The toast when the clipboard refuses. */
  failure: string;
  variant?: ComponentProps<typeof IconButton>["variant"];
  /** Its place's size: `inline` inside content, `header` on a pane's toolbar. */
  size?: ComponentProps<typeof IconButton>["size"];
  className?: string;
}) {
  const { copied, copy } = useCopy(text, failure);
  return (
    <IconButton
      label={copied ? copiedLabel : label}
      variant={variant}
      size={size}
      className={className}
      onClick={copy}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </IconButton>
  );
}
