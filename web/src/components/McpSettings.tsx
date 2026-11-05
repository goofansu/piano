import type { McpCatalogId, McpSetupChange, McpSetupRequest } from "@shared/mcp";
import { CheckCircle2Icon, ServerIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCommands } from "@/components/CommandHost";
import { GlobalCommandIcon } from "@/components/GlobalCommandIcon";
import { McpServerDialog } from "@/components/McpServerDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import {
  SettingsAlert,
  SettingsGroup,
  SettingsList,
  SettingsLoadFailure,
  SettingsSectionFrame,
  SettingsSkeleton,
  settingsRow,
} from "@/components/SettingsSectionFrame";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { changeMcpSetup, mcpLogin, mcpSetup } from "@/lib/api";
import { pageCommands } from "@/lib/globalCommands";
import {
  type McpAvailableRow,
  type McpServerRow,
  mcpManageCopy,
  mcpSetupView,
} from "@/lib/mcpSetupView";
import { useLastShown } from "@/lib/useLastShown";
import { mcpServerEditor, useMcpServerEditor } from "@/lib/useMcpServerEditor";
import { useObservation } from "@/lib/useObservation";
import { useSetupActions } from "@/lib/useSetupActions";

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
 * manage each (edit, disconnect or delete), all through Pi. A URL server is saved only once it
 * connects; the sign-in it asks for first opens straight away. */
export function McpSettings() {
  const setup = useObservation("mcp", (signal) => mcpSetup({ signal }));
  // Add MCP server comes from `pageCommands`, which the palette lists too; both open this editor.
  const { state: app, run: runCommand, global } = useCommands();
  const editing = useMcpServerEditor();
  const [managing, setManaging] = useState<McpServerRow | undefined>();
  const actions = useSetupActions<never, SignInSubject>({
    refresh: () => void setup.refresh(),
    success: (text) => toast.success(text),
  });
  const { signIn } = actions;
  const busy = actions.running !== undefined;
  const view = mcpSetupView({
    state: setup.value,
    running: actions.running,
    loading: setup.loading,
    loadFailed: !!setup.failure,
  });
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
      actions={pageCommands(app, global.settings).map((c) => (
        <Button
          key={c.id}
          size="sm"
          disabled={!c.enabled || !!view.problem}
          onClick={() => runCommand(c)}
        >
          <GlobalCommandIcon icon={c.icon} data-icon="inline-start" /> {c.label}
        </Button>
      ))}
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
          <McpManageDialog
            row={managing}
            busy={busy}
            close={() => setManaging(undefined)}
            edit={(row) => {
              setManaging(undefined);
              mcpServerEditor.open(row.setup);
            }}
            remove={(row) =>
              void act(
                { action: "remove", name: row.setup.name, removalKey: row.setup.removalKey },
                () => mcpManageCopy(row).done,
              ).then((reply) => {
                if (reply) setManaging(undefined);
              })
            }
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
      {/* The failure stays while Retry reads again, so it does not flicker into the skeleton. */}
      {setup.error && (
        <SettingsLoadFailure
          title="Could not load MCP servers"
          retrying={setup.loading}
          retry={() => void setup.refresh()}
        />
      )}
      {view.problem && <SettingsAlert title="MCP is unavailable">{view.problem}</SettingsAlert>}
      {!view.rows ? (
        setup.error ? null : (
          <SettingsSkeleton label="Loading MCP servers…" className="flex flex-col gap-2">
            {[0, 1].map((row) => (
              <Skeleton key={row} className="h-14 w-full rounded-lg" />
            ))}
          </SettingsSkeleton>
        )
      ) : (
        <>
          {view.rows.length > 0 && (
            <SettingsGroup id="settings-mcp-connected" title="Connected">
              <SettingsList>
                {view.rows.map((row) => (
                  <McpServerItem
                    key={row.setup.name}
                    row={row}
                    disabled={view.disabled}
                    manage={() => setManaging(row)}
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
                        reply.signIn ? undefined : `${row.server.name} MCP connected.`,
                      ).then((reply) => signInAfter(reply, row.server.name))
                    }
                  />
                ))}
              </SettingsList>
            </SettingsGroup>
          )}
        </>
      )}
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
  row: { title, catalog, value, ready, detail, reconnect },
  disabled,
  manage,
  reconnect: signIn,
}: {
  row: McpServerRow;
  disabled: boolean;
  manage: () => void;
  reconnect: () => void;
}) {
  // The name and its endpoint or command; a third line appears only for a problem the user must fix in Pi.
  return (
    <Item className={settingsRow}>
      <Logo catalog={catalog} />
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle>
          {title}
          {ready && (
            <>
              <CheckCircle2Icon className="size-3.5 text-brand" aria-hidden />
              <span className="sr-only">(Ready)</span>
            </>
          )}
        </ItemTitle>
        <ItemDescription className="line-clamp-none font-mono text-xs">{value}</ItemDescription>
        {detail && <ItemDescription className="line-clamp-none">{detail}</ItemDescription>}
      </ItemContent>
      <ItemActions className="shrink-0">
        {reconnect && (
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label={`Reconnect ${title} MCP`}
            onClick={signIn}
          >
            Reconnect
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={`Manage ${title} MCP`}
          onClick={manage}
        >
          Manage
        </Button>
      </ItemActions>
    </Item>
  );
}

/** One server's Manage dialog: Edit for a server the user added, and its removal, which this
 * dialog's description states before the destructive button. It stays mounted so it can animate
 * closed. */
function McpManageDialog({
  row,
  busy,
  close,
  edit,
  remove,
}: {
  row: McpServerRow | undefined;
  busy: boolean;
  close: () => void;
  edit: (row: McpServerRow) => void;
  remove: (row: McpServerRow) => void;
}) {
  const shown = useLastShown(row);
  if (!shown) return null;
  return (
    <Dialog
      open={!!row}
      onOpenChange={(next) => {
        if (!next && !busy) close();
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{shown.title} MCP</DialogTitle>
          <DialogDescription>{mcpManageCopy(shown).description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={close}>
            Cancel
          </Button>
          {shown.editable && (
            <Button variant="outline" disabled={busy} onClick={() => edit(shown)}>
              Edit
            </Button>
          )}
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              if (row) remove(row);
            }}
          >
            {busy && <Spinner data-icon="inline-start" />}
            {shown.removeVerb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || !!detail}
          aria-label={`Connect ${server.name} MCP`}
          onClick={connect}
        >
          {connecting && <Spinner data-icon="inline-start" />}
          Connect
        </Button>
      </ItemActions>
    </Item>
  );
}
