import { WrapTextIcon } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { useCodeWrap } from "@/lib/useCodeWrap";

/** The remembered wrap preference as a header action, filled while on, as the rail toggle is. */
export function WrapButton() {
  const [wrap, setWrap] = useCodeWrap();
  return (
    <IconButton
      size="header"
      label="Wrap"
      aria-pressed={wrap}
      onClick={() => setWrap(!wrap)}
      className="aria-pressed:bg-muted"
    >
      <WrapTextIcon />
    </IconButton>
  );
}
