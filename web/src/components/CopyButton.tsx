import { CheckIcon, CopyIcon } from "lucide-react";
import { type ComponentProps, useEffect, useState } from "react";
import { toast } from "sonner";
import { IconButton } from "@/components/IconButton";

/** Copies `text`, its icon turning to a check for two seconds. */
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
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <IconButton
      label={copied ? copiedLabel : label}
      variant={variant}
      size="inline"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          toast.error(failure);
        }
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </IconButton>
  );
}
