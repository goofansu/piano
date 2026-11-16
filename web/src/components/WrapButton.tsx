import { WrapTextIcon } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { useCodeWrap } from "@/lib/useCodeWrap";

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
