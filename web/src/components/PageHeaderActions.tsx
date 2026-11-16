import { useCommands } from "@/components/CommandHost";
import { GlobalCommandIcon } from "@/components/GlobalCommandIcon";
import { Button } from "@/components/ui/button";
import { pageCommands } from "@/lib/globalCommands";

export function PageHeaderActions({ page }: { page: "settings" | "projects" }) {
  const { state, run, global } = useCommands();
  return pageCommands(state, page === "settings" ? global.settings : null).map((c) => (
    <Button key={c.id} size="sm" disabled={!c.enabled} onClick={() => run(c)}>
      <GlobalCommandIcon icon={c.icon} data-icon="inline-start" /> {c.label}
    </Button>
  ));
}
