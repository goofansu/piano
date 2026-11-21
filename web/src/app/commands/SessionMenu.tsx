import {
  SessionCommandMenuItem,
  useCommands,
  useSessionCommands,
} from "@features/commands/web/commandContext";
import { sessionRowMenu } from "@features/commands/web/sessionCommands";
import { ProjectMenu } from "@features/projects/web/Projects";
import { Fragment } from "react";
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/shared/components/PianoDropdownMenu";
import { sessionProjectMenu } from "@/shared/state/projectActions";
import type { SessionEntry } from "@/shared/state/sessionCatalog";

export function SessionMenu({
  target,
}: {
  target: { cwd: string; sessionId: string; title: string | undefined; hint?: string | undefined };
}) {
  const { state } = useCommands();
  const { commands, run } = useSessionCommands(target);
  const { sections } = sessionRowMenu(commands);
  return (
    <>
      {target.hint && (
        <>
          <DropdownMenuGroup>
            <DropdownMenuLabel className="max-w-72 font-normal text-ink-3">
              {target.hint}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </>
      )}
      {sections.map((section, i) => (
        <Fragment key={section === "project" ? section : section[0]?.id}>
          {i > 0 && <DropdownMenuSeparator />}
          <DropdownMenuGroup>
            {section === "project" ? (
              <ProjectMenu menu={sessionProjectMenu(state, target)} run={run} />
            ) : (
              section.map((c) => <SessionCommandMenuItem key={c.id} command={c} run={run} />)
            )}
          </DropdownMenuGroup>
        </Fragment>
      ))}
    </>
  );
}

export const renderSessionMenu = (session: SessionEntry) => <SessionMenu target={session} />;
