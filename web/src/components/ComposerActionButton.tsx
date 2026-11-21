import { cn } from "cn";
import type { ComponentProps, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { Button, buttonVariants } from "@/components/ui/button";
import { composerAction } from "@/lib/styles";

export type ComposerActionFace = "primary" | "neutral" | "recording";

const FACE_VARIANT = {
  primary: "default",
  neutral: "secondary",
  recording: "destructive",
} as const satisfies Record<ComposerActionFace, ComponentProps<typeof Button>["variant"]>;

const faceClass =
  "relative size-9 rounded-full bg-clip-border [--secondary:var(--fill-active)] active:not-aria-[haspopup]:translate-none";

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
      <TooltipTrigger
        render={
          <Button
            {...props}
            size="icon"
            variant={null}
            data-motion="press"
            className={cn(composerAction, className)}
            aria-label={label}
          >
            <span
              aria-hidden
              className={cn(
                buttonVariants({ variant: FACE_VARIANT[face], size: "icon" }),
                faceClass,
              )}
            >
              {children}
            </span>
          </Button>
        }
      />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
