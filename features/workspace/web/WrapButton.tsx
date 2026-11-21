import { WrapTextIcon } from "lucide-react";
import { IconButton } from "@/shared/components/IconButton";
import { useCodeWrap } from "@/shared/lib/useCodeWrap";

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
