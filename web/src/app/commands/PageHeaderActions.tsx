import { pageCommands } from "@features/commands/web";
import { useCommands, GlobalCommandIcon } from "@features/commands/web/browser";
import { Button } from "@/components/ui/button";

export function PageHeaderActions({ page }: { page: "settings" | "projects" }) {
  const { state, run, global } = useCommands();
  return pageCommands(state, {
    ...global,
    settings: page === "settings" ? global.settings : null,
  }).map((c) => (
    <Button key={c.id} data-command={c.id} size="sm" disabled={!c.enabled} onClick={() => run(c)}>
      <GlobalCommandIcon icon={c.icon} data-icon="inline-start" /> {c.label}
    </Button>
  ));
}
