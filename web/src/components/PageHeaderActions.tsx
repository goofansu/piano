import { useCommands } from "@/components/CommandHost";
import { GlobalCommandIcon } from "@/components/GlobalCommandIcon";
import { Button } from "@/components/ui/button";
import { pageCommands } from "@/lib/globalCommands";
import { useOffers } from "@/lib/useMachine";

export function PageHeaderActions({ page }: { page: "settings" | "projects" }) {
  const { state, run, global } = useCommands();
  const offers = useOffers();
  return pageCommands(state, page === "settings" ? global.settings : null, offers).map((c) => (
    <Button key={c.id} data-command={c.id} size="sm" disabled={!c.enabled} onClick={() => run(c)}>
      <GlobalCommandIcon icon={c.icon} data-icon="inline-start" /> {c.label}
    </Button>
  ));
}
