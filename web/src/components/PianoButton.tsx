import { cn } from "cn";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

const variants = {
  // Stays solid on hover, so whatever the button floats over never shows through it.
  "outline-solid":
    "border border-input bg-popover text-popover-foreground shadow-xs hover:bg-popover-hover",
  "outline-transparent": "border border-input bg-transparent hover:border-ring",
};

/**
 * An icon-only button's size, named by where it sits, so each place has one size: 32px in a
 * header or toolbar (a pane's, the sidebar's, a picker's, a Settings group's) and on a list row's
 * action outside the sidebar (a Settings list, the Projects index, the right sidebar's lists); 24px
 * on a sidebar row, whose rows are 36px; 24px inside content (a code block, a quote, the PDF
 * toolbar). A touch screen grows each to a target it can hit: 44px, or 36px inside a sidebar row,
 * where 44px would fill the row. Controls inside content stay put, sized to what they sit in.
 */
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

type Props = Omit<ComponentProps<typeof Button>, "variant" | "size"> & {
  variant?: ComponentProps<typeof Button>["variant"] | keyof typeof variants;
  /** A shadcn size, or for an icon-only button the place it sits in. */
  size?: ComponentProps<typeof Button>["size"] | IconPlace;
};

const isPlace = (size: Props["size"]): size is IconPlace =>
  typeof size === "string" && Object.hasOwn(places, size);

/** App variants opt out of the base variant so its hover/dark styles cannot leak through. */
export function PianoButton({ variant, size, className, ...props }: Props) {
  const sized = isPlace(size)
    ? { size: places[size].size, className: cn(places[size].className, className) }
    : { size, className };
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
