import { useCommands } from "@features/commands/web/commandContext";
import { GlobalCommandIcon } from "@features/commands/web/GlobalCommandIcon";
import { pageCommands } from "@features/commands/web/globalCommands";
import { Button } from "@/components/ui/button";

export function PageHeaderActions({ page }: { page: "settings" | "projects" }) {
  const { state, run, global } = useCommands();
  return pageCommands(
    state,
    page === "settings" ? global.settings : null,
    global.editorAvailable,
  ).map((c) => (
    <Button key={c.id} data-command={c.id} size="sm" disabled={!c.enabled} onClick={() => run(c)}>
      <GlobalCommandIcon icon={c.icon} data-icon="inline-start" /> {c.label}
    </Button>
  ));
}
