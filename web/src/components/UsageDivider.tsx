import { Separator } from "@/components/ui/separator";

/**
 * The short divider between the usage row's buttons. Vega's vertical Separator stretches to the
 * row, so a divider capped at h-3 must also centre itself, or it anchors to the top of the 32px
 * row instead of centring on the labels. One component, so every button's divider agrees.
 */
export function UsageDivider() {
  return <Separator orientation="vertical" className="h-3! self-center!" />;
}
