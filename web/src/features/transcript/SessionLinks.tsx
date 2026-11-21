import { ArrowUpRightIcon, CornerDownRightIcon } from "lucide-react";
import { createContext, useContext } from "react";
import { IconLink } from "@/components/IconButton";
import { routePath } from "@/lib/routes";
import type { SessionDestination } from "@/lib/sessionCatalog";
import { NavigationContext } from "@/lib/useNavigation";
import { Row } from "./Row";

export const SessionDestinationContext = createContext<
  (sessionId: string) => SessionDestination | "unlisted"
>(() => "unlisted");

function useSessionLink(cwd: string, sessionId: string) {
  const navigation = useContext(NavigationContext);
  return {
    href: routePath({ kind: "session", sessionId }),
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (!navigation || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey)
        return;
      event.preventDefault();
      navigation.select(cwd, sessionId);
    },
  };
}

export function OpenSession({ cwd, sessionId }: SessionDestination) {
  const link = useSessionLink(cwd, sessionId);
  return (
    <IconLink {...link} label="Open session" size="inline" className="-my-1 shrink-0 text-ink-3">
      <ArrowUpRightIcon className="size-3.5" />
    </IconLink>
  );
}

export function DispatchedFrom({ parent }: { parent: SessionDestination | "unlisted" }) {
  return (
    <Row
      glyph={<CornerDownRightIcon className="size-3.5 text-ink-3" aria-hidden />}
      className="text-sm"
    >
      <p data-slot="dispatched-from" className="truncate text-ink-3">
        Dispatched from {parent === "unlisted" ? "another session" : <ParentLink {...parent} />}
      </p>
    </Row>
  );
}

function ParentLink({ sessionId, cwd, label }: SessionDestination) {
  const link = useSessionLink(cwd, sessionId);
  return (
    <a
      {...link}
      className="font-medium text-ink-2 underline-offset-4 outline-none hover:text-ink hover:underline focus-visible:underline"
    >
      {label}
    </a>
  );
}
