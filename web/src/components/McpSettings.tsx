import type { McpCatalogId, McpServerSetup, McpSetupRequest, McpSetupState } from "@shared/mcp";
import { CheckCircle2Icon, ServerIcon } from "lucide-react";
import { toast } from "sonner";
import { useCommands } from "@/components/CommandHost";
import { GlobalCommandIcon } from "@/components/GlobalCommandIcon";
import { McpServerDialog } from "@/components/McpServerDialog";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { RemovalDialog, signOutCopy } from "@/components/RemovalDialog";
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
import { mcpLogin, mcpSetup } from "@/lib/api";
import { pageCommands } from "@/lib/globalCommands";
import {
  type McpAvailableRow,
  type McpServerRow,
  mcpRemovalCopy,
  mcpSetupView,
  signInAfterAdd,
  signInAfterInstall,
} from "@/lib/mcpSetupView";
import { mcpServerEditor, useMcpServerEditor } from "@/lib/useMcpServerEditor";
import { useObservation } from "@/lib/useObservation";
import { useSetupActions } from "@/lib/useSetupActions";

// Locally bundled brand marks, one per catalog server; a server the user added shows the server icon.
const SERVER_LOGOS: Record<McpCatalogId, string> = {
  linear: "/mcp-logos.svg#linear",
  jira: "/mcp-logos.svg#jira",
  paper: "/mcp-logos.svg#paper",
};
type Confirmation = { kind: "sign-out"; row: McpServerRow } | { kind: "remove"; row: McpServerRow };
/** The sign-in dialog's subject: the entry, named as the user knows it. */
interface SignInSubject {
  id: string;
  name: string;
}

/** Pi's global MCP servers on this machine: add, edit, sign in, sign out and remove, and add the
 * catalog's, all through Pi. */
export function McpSettings() {
  const setup = useObservation("mcp", (signal) => mcpSetup(undefined, { signal }));
  // Add MCP server comes from `pageCommands`, which the palette lists too; both open this editor.
  const { state: app, run: runCommand, global } = useCommands();
  const editing = useMcpServerEditor();
  const actions = useSetupActions<Confirmation, SignInSubject>({
    refresh: () => void setup.refresh(),
    success: (text) => toast.success(text),
  });
  const { confirmation, signIn } = actions;
  const busy = actions.running !== undefined;
  const view = mcpSetupView({
    state: setup.value,
    running: actions.running,
    loading: setup.loading,
    loadFailed: !!setup.failure,
  });
  const act = (request: McpSetupRequest, done: string) =>
    actions.run({
      id: request.action,
      run: () => setup.mutate(async () => mcpSetup(request)),
      done,
      fallback: "Could not change MCP setup.",
    });
  const openSignIn = (entry: McpServerSetup) =>
    actions.openSignIn({
      id: entry.name,
      name: view.rows?.find((row) => row.setup.name === entry.name)?.title ?? entry.name,
    });
  const { done: removed, ...removalCopy } = mcpRemovalCopy(
    confirmation?.kind === "remove" ? confirmation.row : undefined,
  );
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
              saved={(state: McpSetupState, names) => {
                const next = signInAfterAdd(state, names);
                if (next) openSignIn(next);
              }}
            />
          )}
          <RemovalDialog
            open={!!confirmation}
            busy={busy}
            cancel={actions.cancel}
            {...(confirmation?.kind === "sign-out"
              ? signOutCopy(confirmation.row.title)
              : removalCopy)}
            confirm={() => {
              if (confirmation?.kind === "remove")
                void act(
                  {
                    action: "remove",
                    name: confirmation.row.setup.name,
                    removalKey: confirmation.row.setup.removalKey,
                  },
                  removed,
                );
              else if (confirmation)
                void act(
                  { action: "sign-out", name: confirmation.row.setup.name },
                  `Signed out of ${confirmation.row.title}.`,
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
            <SettingsGroup id="settings-mcp-configured" title="Configured">
              <SettingsList>
                {view.rows.map((row) => (
                  <McpServerItem
                    key={row.setup.name}
                    row={row}
                    disabled={view.disabled}
                    edit={() => mcpServerEditor.open(row.setup)}
                    remove={() => actions.confirm({ kind: "remove", row })}
                    signIn={() => openSignIn(row.setup)}
                    signOut={() => actions.confirm({ kind: "sign-out", row })}
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
                    install={() =>
                      void act(
                        { action: "install", server: row.server.id },
                        `${row.server.name} MCP added.`,
                      ).then((next) => {
                        const entry = signInAfterInstall(next, row.server.id);
                        if (entry) openSignIn(entry);
                      })
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
  row: { title, catalog, value, ready, detail, actions },
  disabled,
  edit,
  remove,
  signIn,
  signOut,
}: {
  row: McpServerRow;
  disabled: boolean;
  edit: () => void;
  remove: () => void;
  signIn: () => void;
  signOut: () => void;
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
        {actions.map((action) =>
          action === "sign-in" ? (
            <Button
              key={action}
              variant="outline"
              size="sm"
              disabled={disabled}
              aria-label={`Sign in to ${title}`}
              onClick={signIn}
            >
              Sign in
            </Button>
          ) : action === "sign-out" ? (
            <Button
              key={action}
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={disabled}
              aria-label={`Sign out of ${title}`}
              onClick={signOut}
            >
              Sign out
            </Button>
          ) : action === "edit" ? (
            <Button
              key={action}
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={disabled}
              aria-label={`Edit ${title} MCP`}
              onClick={edit}
            >
              Edit
            </Button>
          ) : (
            <Button
              key={action}
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={disabled}
              aria-label={`Remove ${title} MCP`}
              onClick={remove}
            >
              Remove
            </Button>
          ),
        )}
      </ItemActions>
    </Item>
  );
}

function McpAvailableItem({
  row: { server, detail },
  disabled,
  install,
}: {
  row: McpAvailableRow;
  disabled: boolean;
  install: () => void;
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
          aria-label={`Add ${server.name} MCP`}
          onClick={install}
        >
          Add
        </Button>
      </ItemActions>
    </Item>
  );
}
