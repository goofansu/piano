import type { McpSetupRequest } from "@shared/mcp";
import { CheckCircle2Icon } from "lucide-react";
import { toast } from "sonner";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { RemovalDialog, signOutCopy } from "@/components/RemovalDialog";
import {
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
import {
  type McpServer,
  type McpServerRow,
  mcpRemovalCopy,
  mcpSetupView,
  signInAfterInstall,
} from "@/lib/mcpSetupView";
import { useObservation } from "@/lib/useObservation";
import { useSetupActions } from "@/lib/useSetupActions";

// Locally bundled brand marks; omit media for servers without a matching logo.
const SERVER_LOGOS: Partial<Record<McpServer["id"], string>> = {
  linear: "/mcp-logos.svg#linear",
  jira: "/mcp-logos.svg#jira",
  paper: "/mcp-logos.svg#paper",
};
type Confirmation =
  | { kind: "sign-out"; server: McpServer }
  | { kind: "uninstall"; server: McpServer; key: string };

/** Catalog MCP servers on this machine: install, sign in, sign out and uninstall, all through Pi. */
export function McpSettings() {
  const setup = useObservation("mcp", (signal) => mcpSetup(undefined, { signal }));
  const actions = useSetupActions<Confirmation, McpServer>({
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
  const { done: removed, ...removalCopy } = mcpRemovalCopy(confirmation?.server.name);
  return (
    <SettingsSectionFrame
      title="MCP"
      dialogs={
        <>
          <RemovalDialog
            open={!!confirmation}
            busy={busy}
            cancel={actions.cancel}
            {...(confirmation?.kind === "sign-out"
              ? signOutCopy(confirmation.server.name)
              : removalCopy)}
            confirm={() => {
              if (confirmation?.kind === "uninstall")
                void act(
                  {
                    action: "uninstall",
                    server: confirmation.server.id,
                    removalKey: confirmation.key,
                  },
                  removed,
                );
              else if (confirmation)
                void act(
                  { action: "sign-out", server: confirmation.server.id },
                  `Signed out of ${confirmation.server.name}.`,
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
      {!view.rows ? (
        setup.error ? null : (
          <SettingsSkeleton label="Loading MCP servers…" className="flex flex-col gap-2">
            {[0, 1].map((row) => (
              <Skeleton key={row} className="h-14 w-full rounded-lg" />
            ))}
          </SettingsSkeleton>
        )
      ) : (
        <SettingsList>
          {view.rows.map((row) => {
            const { server } = row;
            return (
              <McpServerItem
                key={server.id}
                row={row}
                disabled={view.disabled}
                install={() =>
                  void act(
                    { action: "install", server: server.id },
                    `${server.name} MCP installed.`,
                  ).then((next) => {
                    if (signInAfterInstall(next, server.id)) actions.openSignIn(server);
                  })
                }
                uninstall={() =>
                  actions.confirm({ kind: "uninstall", server, key: row.removalKey! })
                }
                signIn={() => actions.openSignIn(server)}
                signOut={() => actions.confirm({ kind: "sign-out", server })}
              />
            );
          })}
        </SettingsList>
      )}
    </SettingsSectionFrame>
  );
}

function McpServerItem({
  row: { server, ready, detail, actions },
  disabled,
  install,
  uninstall,
  signIn,
  signOut,
}: {
  row: McpServerRow;
  disabled: boolean;
  install: () => void;
  uninstall: () => void;
  signIn: () => void;
  signOut: () => void;
}) {
  const logo = SERVER_LOGOS[server.id];
  // Only the name and its actions; a line appears only for a configuration problem the user must fix in Pi.
  return (
    <Item className={settingsRow}>
      {logo && (
        <ItemMedia variant="icon">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <use href={logo} />
          </svg>
        </ItemMedia>
      )}
      <ItemContent className="min-w-0">
        <ItemTitle>
          {server.name}
          {ready && (
            <>
              <CheckCircle2Icon className="size-3.5 text-brand" aria-hidden />
              <span className="sr-only">(Ready)</span>
            </>
          )}
        </ItemTitle>
        {detail && <ItemDescription className="line-clamp-none">{detail}</ItemDescription>}
      </ItemContent>
      <ItemActions className="shrink-0">
        {actions.map((action) =>
          action === "install" ? (
            <Button
              key={action}
              variant="outline"
              size="sm"
              disabled={disabled}
              aria-label={`Install ${server.name} MCP`}
              onClick={install}
            >
              Install
            </Button>
          ) : action === "sign-in" ? (
            <Button
              key={action}
              variant="outline"
              size="sm"
              disabled={disabled}
              aria-label={`Sign in to ${server.name}`}
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
              aria-label={`Sign out of ${server.name}`}
              onClick={signOut}
            >
              Sign out
            </Button>
          ) : (
            <Button
              key={action}
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={disabled}
              aria-label={`Uninstall ${server.name} MCP`}
              onClick={uninstall}
            >
              Uninstall
            </Button>
          ),
        )}
      </ItemActions>
    </Item>
  );
}
