import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "cn";
import type { ComponentProps } from "react";
import { Button, buttonVariants } from "@/components/ui/button";

const variants = {
  "outline-solid":
    "border border-input bg-popover text-popover-foreground shadow-xs hover:bg-popover-hover",
  "outline-transparent": "border border-input bg-transparent hover:border-ring",
};

const places = {
  header: { size: "icon-sm", className: "pointer-coarse:size-11" },
  list: { size: "icon-sm", className: "pointer-coarse:size-11" },
  row: {
    size: "icon-xs",
    className: "pointer-coarse:size-9 pointer-coarse:[&_svg:not([class*='size-'])]:size-4",
  },
  inline: { size: "icon-xs", className: "" },
} as const satisfies Record<
  string,
  { size: ComponentProps<typeof Button>["size"]; className: string }
>;

export type IconPlace = keyof typeof places;

const leadingPad =
  "justify-start pl-[calc(var(--glyph-pad)-1px)] has-data-[icon=inline-start]:pl-[calc(var(--glyph-pad)-1px)]";
const trailingPad =
  "justify-end pr-[calc(var(--glyph-pad)-1px)] has-data-[icon=inline-end]:pr-[calc(var(--glyph-pad)-1px)]";

type Look = {
  variant?: ComponentProps<typeof Button>["variant"] | keyof typeof variants;
  size?: ComponentProps<typeof Button>["size"] | IconPlace;
  leading?: boolean;
  trailing?: boolean;
  className?: string;
};

type Props = Omit<ComponentProps<typeof Button>, "variant" | "size" | "className"> & Look;

const isPlace = (size: Look["size"]): size is IconPlace =>
  typeof size === "string" && Object.hasOwn(places, size);

function look({ variant, size, leading, trailing, className }: Look, role?: string) {
  const placed = cn(
    isPlace(size) && places[size].className,
    leading && leadingPad,
    trailing && trailingPad,
    role === "menuitem" &&
      "focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none",
    className,
  );
  const sized = isPlace(size) ? places[size].size : size;
  if (variant === "outline-solid" || variant === "outline-transparent")
    return {
      size: sized,
      variant: null,
      "data-variant": variant,
      className: cn(variants[variant], placed),
    };
  return { size: sized, variant, className: placed };
}

export function PianoButton({ variant, size, leading, trailing, className, ...props }: Props) {
  return (
    <Button {...props} {...look({ variant, size, leading, trailing, className }, props.role)} />
  );
}

export function PianoLinkButton({
  variant,
  size,
  leading,
  trailing,
  className,
  render,
  ...props
}: useRender.ComponentProps<"a"> & Look) {
  const { "data-variant": custom, ...face } = look({ variant, size, leading, trailing, className });
  return useRender({
    defaultTagName: "a",
    render,
    props: mergeProps<"a">(
      {
        "data-slot": "button",
        "data-variant": custom,
        className: buttonVariants(face),
      } as ComponentProps<"a">,
      props,
    ),
  });
}
