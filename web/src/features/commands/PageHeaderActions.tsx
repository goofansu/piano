import { Button } from "@/components/ui/button";
import { useCommands } from "@/features/commands/CommandHost";
import { GlobalCommandIcon } from "@/features/commands/GlobalCommandIcon";
import { pageCommands } from "@/features/commands/globalCommands";

export function PageHeaderActions({ page }: { page: "settings" | "projects" }) {
  const { state, run, global } = useCommands();
  return pageCommands(state, page === "settings" ? global.settings : null).map((c) => (
    <Button key={c.id} data-command={c.id} size="sm" disabled={!c.enabled} onClick={() => run(c)}>
      <GlobalCommandIcon icon={c.icon} data-icon="inline-start" /> {c.label}
    </Button>
  ));
}
