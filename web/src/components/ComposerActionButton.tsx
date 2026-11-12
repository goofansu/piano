import { cn } from "cn";
import type { ComponentProps, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { Button, buttonVariants } from "@/components/ui/button";
import { composerAction } from "@/lib/styles";

/** What a composer action face says: the turn's primary action, a neutral one, or a live recording. */
export type ComposerActionFace = "primary" | "neutral" | "recording";

// Each role paints with shadcn's own button variant.
const FACE_VARIANT = {
  primary: "default",
  neutral: "secondary",
  recording: "destructive",
} as const satisfies Record<ComposerActionFace, ComponentProps<typeof Button>["variant"]>;

// The face borrows the button's class string, so it undoes what only a real button needs:
// the outer button owns press motion; the decorative span must not translate a second time.
// Fills reach the border box: clipped to padding, a borderless face paints 2px smaller than Stop's outlined one.
// A neutral face (mic, Stop) takes the stronger fill: at the base 6% its edge fades beside solid Send.
const faceClass =
  "relative size-9 rounded-full bg-clip-border [--secondary:var(--fill-active)] active:not-aria-[haspopup]:translate-none";

/** A circular composer face inside a real, nonoverlapping 44px touch target. */
export function ComposerActionButton({
  label,
  tooltip = label,
  face = "primary",
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "size" | "asChild" | "variant"> & {
  label: string;
  tooltip?: ReactNode;
  face?: ComposerActionFace;
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
            className={cn(buttonVariants({ variant: FACE_VARIANT[face], size: "icon" }), faceClass)}
          >
            {children}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
