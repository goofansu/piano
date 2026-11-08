import type { McpCatalogId, McpSetupChange, McpSetupRequest } from "@shared/mcp";
import { ServerIcon } from "lucide-react";
import { toast } from "sonner";
import { McpServerDialog } from "@/components/McpServerDialog";
import { PageHeaderActions } from "@/components/PageHeaderActions";
import { PianoButton } from "@/components/PianoButton";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/PianoDropdownMenu";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { RemovalDialog } from "@/components/RemovalDialog";
import { ListRow, RowMenu, RowStatus } from "@/components/RowActions";
import {
  SettingsAlert,
  SettingsGroup,
  SettingsList,
  SettingsLoadState,
  SettingsSectionFrame,
  settingsRow,
} from "@/components/SettingsSectionFrame";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { changeMcpSetup, mcpLogin, mcpSetup } from "@/lib/api";
import {
  type McpAvailableRow,
  type McpServerRow,
  mcpRemovalCopy,
  mcpSetupView,
} from "@/lib/mcpSetupView";
import { PAGE_EDITORS } from "@/lib/pageEditor";
import { settingsLoadView } from "@/lib/settingsLoadView";
import { useObservation } from "@/lib/useObservation";
import { useSetupActions } from "@/lib/useSetupActions";

const mcpServerEditor = PAGE_EDITORS.mcp.editor;

// Locally bundled brand marks, one per catalog server; any other server shows the server icon.
const SERVER_LOGOS: Record<McpCatalogId, string> = {
  linear: "/mcp-logos.svg#linear",
  jira: "/mcp-logos.svg#jira",
};
/** The sign-in dialog's subject: the entry, named as the user knows it. */
interface SignInSubject {
  id: string;
  name: string;
}

/** Pi's global MCP servers on this machine: connect a catalog server, add the user's own, and
 * manage each (edit, then disconnect or delete after confirming), all through Pi. A URL server is saved only once it
 * connects; the sign-in it asks for first opens straight away. */
export function McpSettings() {
  const setup = useObservation("mcp", (signal) => mcpSetup({ signal }));
  // Add MCP server comes from `pageCommands` (the header and the palette); both open this editor.
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
  // Pi's config is unusable, so a save would be refused: the header and the palette both say so.
  mcpServerEditor.useAvailable(!view.problem);
  const titleOf = (name: string) =>
    view.rows?.find((row) => row.setup.name === name)?.title ?? name;
  /** Sign in to the server a change left waiting, which the sign-in saves. */
  const signInAfter = (reply: McpSetupChange | undefined, name: string) => {
    if (reply?.signIn) actions.openSignIn({ id: reply.signIn, name });
  };
  const act = (request: McpSetupRequest, done: (reply: McpSetupChange) => string | undefined) =>
    actions.run({
      // A connect names its server, so only that row's button turns.
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
      title="MCP"
      actions={<PageHeaderActions page="settings" />}
      dialogs={
        <>
          {editing && (
            <McpServerDialog
              key={editing === "new" ? "new" : editing.name}
              entry={editing === "new" ? undefined : editing}
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
          <ProviderLoginDialog
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
          // Pi's problem is the page's message, so it shows in place of the empty line.
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
            <DropdownMenuItem onSelect={edit}>Edit</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem variant="destructive" onSelect={remove}>
        {removeVerb}
      </DropdownMenuItem>
    </RowMenu>
  );
  // The name, its endpoint or command, then its state: ready, or a problem the user must fix in Pi.
  // Reconnect is the row's call to action, so its menu stays beside it rather than over it.
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
