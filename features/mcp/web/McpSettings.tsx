import type {
  McpCatalogId,
  McpServerSetup,
  McpSetupChange,
  McpSetupRequest,
} from "@features/mcp/contracts/mcp";
import { changeMcpSetup, mcpLogin, mcpSetup } from "@features/mcp/web/mcpApi";
import { McpServerDialog } from "@features/mcp/web/McpServerDialog";
import {
  type McpAvailableRow,
  type McpServerRow,
  mcpRemovalCopy,
  mcpSetupView,
} from "@features/mcp/web/mcpSetupView";
import { ServerIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { PianoButton } from "@/shared/components/PianoButton";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/shared/components/PianoDropdownMenu";
import { RemovalDialog } from "@/shared/components/RemovalDialog";
import { ListRow, RowMenu, RowStatus, settingsRow } from "@/shared/components/RowActions";
import {
  SettingsAlert,
  SettingsGroup,
  SettingsList,
  SettingsLoadState,
  SettingsSectionFrame,
} from "@/shared/components/SettingsSectionFrame";
import type { PageEditorProps } from "@/shared/lib/pageEditor";
import { settingsLoadView } from "@/shared/lib/settingsLoadView";
import { useObservation } from "@/shared/lib/useObservation";
import { useSetupActions } from "@/shared/lib/useSetupActions";
import { SignInDialog } from "@/shared/sign-in/SignInDialog";

const SERVER_LOGOS: Record<McpCatalogId, string> = {
  linear: "/mcp-logos.svg#linear",
  jira: "/mcp-logos.svg#jira",
};
interface SignInSubject {
  id: string;
  name: string;
}

export function McpSettings({
  editor: mcpServerEditor,
  headerActions,
}: PageEditorProps<McpServerSetup>) {
  const setup = useObservation("mcp", (signal) => mcpSetup({ signal }));
  const editing = mcpServerEditor.useEditing();
  const actions = useSetupActions<McpServerRow, SignInSubject>({
    refresh: () => void setup.refresh(),
    success: (text) => toast.success(text),
  });
  const { signIn, confirmation: removing } = actions;
  const removal = removing && mcpRemovalCopy(removing);
  const busy = actions.running !== undefined;
  const view = mcpSetupView({
    state: setup.value,
    running: actions.running,
    loading: setup.loading,
  });
  mcpServerEditor.useAvailable(!view.problem);
  const titleOf = (name: string) =>
    view.rows?.find((row) => row.setup.name === name)?.title ?? name;
  const signInAfter = (reply: McpSetupChange | undefined, name: string) => {
    if (reply?.signIn) actions.openSignIn({ id: reply.signIn, name });
  };
  const act = (request: McpSetupRequest, done: (reply: McpSetupChange) => string | undefined) =>
    actions.run({
      id: request.action === "connect" ? `connect:${request.server}` : request.action,
      run: async () => {
        let reply: McpSetupChange | undefined;
        await setup.mutate(async () => {
          reply = await changeMcpSetup(request);
          return reply.state;
        });
        return reply!;
      },
      done,
      fallback: "Could not change MCP setup.",
    });
  return (
    <SettingsSectionFrame
      section="mcp"
      actions={headerActions}
      dialogs={
        <>
          {editing && (
            <McpServerDialog
              key={editing.key}
              entry={editing.target === "new" ? undefined : editing.target}
              close={mcpServerEditor.close}
              refresh={() => void setup.refresh()}
              saved={(reply, name) => signInAfter(reply, name)}
            />
          )}
          <RemovalDialog
            open={!!removing}
            title={removal?.title ?? ""}
            description={removal?.description ?? ""}
            action={removal?.action ?? ""}
            progress={removal?.progress}
            busy={busy}
            cancel={actions.cancel}
            confirm={() => {
              if (!removing || !removal) return;
              void act(
                {
                  action: "remove",
                  name: removing.setup.name,
                  removalKey: removing.setup.removalKey,
                },
                () => removal.done,
              );
            }}
          />
          <SignInDialog
            api={mcpLogin}
            signIn={signIn && { key: signIn.key, provider: signIn.subject.id }}
            providers={
              signIn ? [{ id: signIn.subject.id, name: signIn.subject.name, signedIn: false }] : []
            }
            close={() => {
              actions.closeSignIn();
              void setup.refresh();
            }}
            signedIn={() => void setup.refresh()}
          />
        </>
      }
    >
      <SettingsLoadState
        view={settingsLoadView({
          ...setup,
          isEmpty: (state) => !state.problem && !state.servers.length && !view.available?.length,
        })}
        noun="MCP servers"
        retry={() => void setup.refresh()}
        emptyIcon={ServerIcon}
      >
        {() => (
          <>
            {view.problem && (
              <SettingsAlert title="MCP is unavailable">{view.problem}</SettingsAlert>
            )}
            {view.rows && view.rows.length > 0 && (
              <SettingsGroup id="settings-mcp-connected" title="Connected">
                <SettingsList>
                  {view.rows.map((row) => (
                    <McpServerItem
                      key={row.setup.name}
                      row={row}
                      disabled={view.disabled}
                      edit={() => mcpServerEditor.open(row.setup)}
                      remove={() => actions.confirm(row)}
                      reconnect={() =>
                        actions.openSignIn({ id: row.setup.name, name: titleOf(row.setup.name) })
                      }
                    />
                  ))}
                </SettingsList>
              </SettingsGroup>
            )}
            {view.available && view.available.length > 0 && (
              <SettingsGroup id="settings-mcp-available" title="Available">
                <SettingsList>
                  {view.available.map((row) => (
                    <McpAvailableItem
                      key={row.server.id}
                      row={row}
                      disabled={view.disabled}
                      connecting={actions.running === `connect:${row.server.id}`}
                      connect={() =>
                        void act({ action: "connect", server: row.server.id }, (reply) =>
                          reply.signIn ? undefined : "MCP server connected",
                        ).then((reply) => signInAfter(reply, row.server.name))
                      }
                    />
                  ))}
                </SettingsList>
              </SettingsGroup>
            )}
          </>
        )}
      </SettingsLoadState>
    </SettingsSectionFrame>
  );
}

function Logo({ catalog }: { catalog: McpCatalogId | undefined }) {
  return (
    <ItemMedia variant="icon">
      {catalog ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <use href={SERVER_LOGOS[catalog]} />
        </svg>
      ) : (
        <ServerIcon aria-hidden />
      )}
    </ItemMedia>
  );
}

function McpServerItem({
  row: { title, catalog, value, ready, detail, reconnect, editable, removeVerb },
  disabled,
  edit,
  remove,
  reconnect: signIn,
}: {
  row: McpServerRow;
  disabled: boolean;
  edit: () => void;
  remove: () => void;
  reconnect: () => void;
}) {
  const menu = (
    <RowMenu label={`MCP ${title} actions`} disabled={disabled}>
      {editable && (
        <>
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={edit}>Edit</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem variant="destructive" onClick={remove}>
        {removeVerb}
      </DropdownMenuItem>
    </RowMenu>
  );
  return (
    <ListRow
      media={<Logo catalog={catalog} />}
      title={title}
      menu={menu}
      actions={
        reconnect && (
          <PianoButton
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label={`Reconnect MCP ${title}`}
            onClick={signIn}
          >
            Reconnect
          </PianoButton>
        )
      }
    >
      <ItemDescription className="line-clamp-none font-mono text-xs">{value}</ItemDescription>
      {detail && <ItemDescription className="line-clamp-none">{detail}</ItemDescription>}
      {ready && <RowStatus>Ready</RowStatus>}
    </ListRow>
  );
}

function McpAvailableItem({
  row: { server, detail },
  disabled,
  connecting,
  connect,
}: {
  row: McpAvailableRow;
  disabled: boolean;
  connecting: boolean;
  connect: () => void;
}) {
  return (
    <Item className={settingsRow}>
      <Logo catalog={server.id} />
      <ItemContent className="min-w-0">
        <ItemTitle>{server.name}</ItemTitle>
        {detail && <ItemDescription className="line-clamp-none">{detail}</ItemDescription>}
      </ItemContent>
      <ItemActions className="shrink-0">
        <PianoButton
          variant="outline"
          size="sm"
          disabled={disabled || !!detail}
          aria-label={`Connect MCP ${server.name}`}
          onClick={connect}
        >
          {connecting && <Spinner data-icon="inline-start" />}
          Connect
        </PianoButton>
      </ItemActions>
    </Item>
  );
}
