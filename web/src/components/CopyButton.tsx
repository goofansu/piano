import { CheckIcon, CopyIcon } from "lucide-react";
import { type ComponentProps, useEffect, useState } from "react";
import { toast } from "sonner";
import { IconButton } from "@/components/IconButton";

/** How long a copy control confirms the copy before it offers to copy again. */
const CONFIRMED_MS = 2000;

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
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
      toast.error(failure);
    }
  };
  return { copied, copy };
}

/** Copies `text`, its icon turning to a check while the copy is confirmed. */
export function CopyButton({
  text,
  label,
  copiedLabel,
  failure,
  variant,
  className,
}: {
  text: string;
  label: string;
  copiedLabel: string;
  /** The toast when the clipboard refuses. */
  failure: string;
  variant?: ComponentProps<typeof IconButton>["variant"];
  className?: string;
}) {
  const { copied, copy } = useCopy(text, failure);
  return (
    <IconButton
      label={copied ? copiedLabel : label}
      variant={variant}
      size="inline"
      className={className}
      onClick={copy}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </IconButton>
  );
}
