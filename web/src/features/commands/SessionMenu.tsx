import { Fragment } from "react";
import {
  SessionCommandMenuItem,
  useCommands,
  useSessionCommands,
} from "@/features/commands/CommandHost";
import { sessionRowMenu } from "@/features/commands/sessionCommands";
import { sessionProjectMenu } from "@/features/projects/projectCommands";
import { ProjectMenu } from "@/features/projects/Projects";
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/shared/components/PianoDropdownMenu";

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
