import { cn } from "cn";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

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

type Props = Omit<ComponentProps<typeof Button>, "variant" | "size"> & {
  variant?: ComponentProps<typeof Button>["variant"] | keyof typeof variants;
  size?: ComponentProps<typeof Button>["size"] | IconPlace;
  leading?: boolean;
  trailing?: boolean;
};

const isPlace = (size: Props["size"]): size is IconPlace =>
  typeof size === "string" && Object.hasOwn(places, size);

export function PianoButton({ variant, size, leading, trailing, className, ...props }: Props) {
  const placed = cn(
    isPlace(size) && places[size].className,
    leading && leadingPad,
    trailing && trailingPad,
    props.role === "menuitem" &&
      "focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none",
    className,
  );
  const sized = { size: isPlace(size) ? places[size].size : size, className: placed };
  if (variant === "outline-solid" || variant === "outline-transparent") {
    return (
      <Button
        {...props}
        size={sized.size}
        variant={null}
        data-variant={variant}
        className={cn(variants[variant], sized.className)}
      />
    );
  }
  return <Button {...props} variant={variant} size={sized.size} className={sized.className} />;
}
