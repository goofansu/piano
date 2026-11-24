import { type Command } from "@features/commands/web/commands";
import { type GlobalCommandContext, globalCommands } from "@features/commands/web/globalCommands";
import {
  type SessionCommand,
  type SessionCommandIcon,
  type SessionTarget,
  sessionCommands,
} from "@features/commands/web/sessionCommands";
import type { Snapshot } from "@shared/wire";
import {
  ArchiveIcon,
  CopyIcon,
  FileDiffIcon,
  GitPullRequestIcon,
  HashIcon,
  ListIcon,
  type LucideIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  PinIcon,
  PinOffIcon,
  ShapesIcon,
  Share2Icon,
  SquarePenIcon,
  TextCursorInputIcon,
  Trash2Icon,
  WrapTextIcon,
} from "lucide-react";
import { createContext, useContext } from "react";
import { DropdownMenuItem } from "@/shared/components/PianoDropdownMenu";
import type { SessionLayout } from "@/shared/navigation/navigation";
import type { ProjectDestination, SessionProjectMenu } from "@/shared/state/projectCommandTypes";
import type { AppState } from "@/shared/state/state";

const ICONS: Record<SessionCommandIcon, LucideIcon> = {
  copy: CopyIcon,
  hash: HashIcon,
  changes: FileDiffIcon,
  wrap: WrapTextIcon,
  artifacts: ShapesIcon,
  list: ListIcon,
  agent: MessagesSquareIcon,
  "pull-request": GitPullRequestIcon,
  messages: MessageSquareIcon,
  rename: TextCursorInputIcon,
  share: Share2Icon,
  pin: PinIcon,
  unpin: PinOffIcon,
  archive: ArchiveIcon,
  delete: Trash2Icon,
  new: SquarePenIcon,
};

export function CommandIcon({ icon }: { icon: SessionCommandIcon }) {
  const Icon = ICONS[icon];
  return <Icon />;
}

interface CommandsValue {
  run: (command: Command) => void;
  messagesOnly: boolean;
  layout: SessionLayout;
  codeWrap: boolean;
  state: AppState;
  hasArtifacts: (session: Snapshot) => boolean;
  global: GlobalCommandContext;
  openProjectCommands: (state: AppState) => ProjectDestination[];
  sessionProjectMenu: (
    state: AppState,
    session: { cwd: string; sessionId: string },
  ) => SessionProjectMenu;
}
export const CommandsContext = createContext<CommandsValue | null>(null);

export function useCommands() {
  const value = useContext(CommandsContext);
  if (!value) throw new Error("useCommands needs a CommandHost");
  return value;
}

export function useSessionCommands(target?: SessionTarget) {
  const { state, run, messagesOnly, codeWrap, layout, hasArtifacts } = useCommands();
  return {
    commands: sessionCommands(state, target, { messagesOnly, codeWrap, layout, hasArtifacts }),
    run,
    messagesOnly,
  };
}

export function useSessionProjectMenu() {
  const { state, sessionProjectMenu } = useCommands();
  const session = state.session;
  return session?.sessionId
    ? sessionProjectMenu(state, { cwd: session.cwd, sessionId: session.sessionId })
    : undefined;
}

export function useGlobalCommands() {
  const { state, run, global } = useCommands();
  return { commands: globalCommands(state, global), run };
}

export function SessionCommandMenuItem({
  command,
  run,
}: {
  command: SessionCommand;
  run: (command: SessionCommand) => void;
}) {
  return (
    <DropdownMenuItem
      variant={command.destructive ? "destructive" : undefined}
      disabled={!command.enabled}
      onClick={() => run(command)}
    >
      <CommandIcon icon={command.icon} /> {command.label}
    </DropdownMenuItem>
  );
}
