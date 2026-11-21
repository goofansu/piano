import { CheckIcon, CopyIcon } from "lucide-react";
import { type ComponentProps, useEffect, useState } from "react";
import { toast } from "sonner";
import { IconButton } from "@/shared/components/IconButton";

const CONFIRMED_MS = 2000;

export async function copyText(text: string, failure: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toast.error(failure);
    return false;
  }
}

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
  failure: string;
  variant?: ComponentProps<typeof IconButton>["variant"];
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
