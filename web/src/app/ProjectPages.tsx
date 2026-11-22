import { useCommands } from "@features/commands/web/browser";
import { ProjectHome, ProjectsIndex } from "@features/projects/web/browser";
import type { ComponentProps } from "react";
import { PageHeaderActions } from "@/app/commands/PageHeaderActions";
import { NewSessionComposer } from "@/app/sessions/NewSession";
import { renderSessionMenu } from "./commands/SessionMenu";

export function ProjectsPage(
  props: Pick<ComponentProps<typeof ProjectsIndex>, "state" | "openProject">,
) {
  const { run } = useCommands();
  return <ProjectsIndex {...props} run={run} actions={<PageHeaderActions page="projects" />} />;
}

export function ProjectHomePage({
  client,
  chooseDirectory,
  ...props
}: Pick<ComponentProps<typeof ProjectHome>, "state" | "projectId" | "select" | "openProjects"> &
  Pick<ComponentProps<typeof NewSessionComposer>, "client" | "chooseDirectory">) {
  const { run } = useCommands();
  return (
    <ProjectHome
      {...props}
      run={run}
      sessionMenu={renderSessionMenu}
      composer={
        <NewSessionComposer state={props.state} client={client} chooseDirectory={chooseDirectory} />
      }
    />
  );
}
