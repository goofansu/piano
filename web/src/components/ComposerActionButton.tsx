import { cn } from "cn";
import type { ComponentProps, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { Button, buttonVariants } from "@/components/ui/button";
import { composerAction, composerActionFace } from "@/lib/styles";

/** A circular composer face inside a real, nonoverlapping 44px touch target. */
export function ComposerActionButton({
  label,
  tooltip = label,
  variant = "default",
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "size" | "asChild"> & {
  label: string;
  tooltip?: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          {...props}
          size="icon"
          variant={null}
          data-motion="press"
          className={cn(composerAction, className)}
          aria-label={label}
        >
          {/* Not another control: the whole outer button is tappable and owns focus/disabled. */}
          <span
            aria-hidden
            className={cn(buttonVariants({ variant, size: "icon" }), composerActionFace)}
          >
            {children}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
