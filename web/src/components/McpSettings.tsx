import { MCP_CATALOG, type McpServerSetup, type McpSetupRequest } from "@shared/mcp";
import { CheckCircle2Icon } from "lucide-react";
import { toast } from "sonner";
import { PianoSkeleton as Skeleton } from "@/components/PianoSkeleton";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { ProviderSignOutDialog } from "@/components/ProviderSignOutDialog";
import { RemovalDialog } from "@/components/RemovalDialog";
import {
  SettingsAlert,
  SettingsSectionFrame,
  SettingsSkeleton,
} from "@/components/SettingsSectionFrame";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { mcpLogin, mcpSetup } from "@/lib/api";
import { useObservation } from "@/lib/useObservation";
import { useSetupActions } from "@/lib/useSetupActions";

type Server = (typeof MCP_CATALOG)[number];
// Locally bundled Simple Icons logos; omit media for servers without a matching logo.
const SERVER_LOGOS: Partial<Record<Server["id"], string>> = {
  linear: "/mcp-logos.svg#linear",
};
type Confirmation =
  | { kind: "sign-out"; server: Server }
  | { kind: "uninstall"; server: Server; key: string };

/** Catalog MCP servers on this machine: install, sign in, sign out and uninstall, all through Pi. */
export function McpSettings() {
  const setup = useObservation("mcp", (signal) => mcpSetup(undefined, { signal }));
  const actions = useSetupActions<Confirmation, Server>({
    refresh: () => void setup.refresh(),
    success: (text) => toast.success(text),
  });
  const { confirmation, confirming, signIn } = actions;
  const busy = actions.running !== undefined;
  const servers = setup.value?.servers;
  const error =
    setup.error && !setup.loading
      ? "Could not load MCP servers. Check your connection and try again."
      : "";
  const act = (request: McpSetupRequest, done: string) =>
    actions.run({
      id: request.action,
      run: () => setup.mutate(async () => mcpSetup(request)),
      done,
      fallback: "Could not change MCP setup. Refresh before retrying.",
    });
  const disabled = busy || setup.loading || !!error;
  const removal = confirmation?.kind === "uninstall" ? confirmation : undefined;
  return (
    <SettingsSectionFrame
      title="MCP"
      dialogs={
        <>
          {/* Keeps the last removal's wording while it animates closed. */}
          <RemovalDialog
            open={confirming && !!removal}
            busy={busy}
            cancel={actions.cancel}
            action="Uninstall"
            title={`Uninstall ${removal?.server.name} MCP?`}
            description={`Removes ${removal?.server.name} MCP and its saved sign-in from Pi on this machine.`}
            confirm={() => {
              if (removal)
                void act(
                  { action: "uninstall", server: removal.server.id, removalKey: removal.key },
                  `${removal.server.name} MCP uninstalled for new sessions.`,
                );
            }}
          />
          {confirming && confirmation?.kind === "sign-out" && (
            <ProviderSignOutDialog
              name={confirmation.server.name}
              busy={busy}
              cancel={actions.cancel}
              confirm={() =>
                void act(
                  { action: "sign-out", server: confirmation.server.id },
                  `Signed out of ${confirmation.server.name}.`,
                )
              }
            />
          )}
          {signIn && (
            <ProviderLoginDialog
              key={signIn.key}
              api={mcpLogin}
              initialProvider={signIn.subject.id}
              providers={[{ id: signIn.subject.id, name: signIn.subject.name, signedIn: false }]}
              close={() => {
                actions.closeSignIn();
                void setup.refresh();
              }}
              signedIn={() => void setup.refresh()}
            />
          )}
        </>
      }
    >
      {(error || actions.error) && (
        <SettingsAlert title="MCP setup needs attention">{error || actions.error}</SettingsAlert>
      )}
      {!servers ? (
        <SettingsSkeleton label="Loading MCP servers…">
          <Skeleton className="h-20 w-full rounded-xl" />
        </SettingsSkeleton>
      ) : (
        <ItemGroup className="gap-2">
          {MCP_CATALOG.map((server) => {
            const state = servers.find((s) => s.id === server.id);
            return (
              state && (
                <McpServerItem
                  key={server.id}
                  server={server}
                  state={state}
                  disabled={disabled}
                  install={() =>
                    void act(
                      { action: "install", server: server.id },
                      `${server.name} MCP installed.`,
                    ).then((next) => {
                      // Installing is the decision to use it: go straight on to signing in.
                      const installed = next?.servers.find((s) => s.id === server.id);
                      if (installed?.status === "ready" && installed.oauth && !installed.signedIn)
                        actions.openSignIn(server);
                    })
                  }
                  uninstall={() =>
                    actions.confirm({ kind: "uninstall", server, key: state.removalKey! })
                  }
                  signIn={() => actions.openSignIn(server)}
                  signOut={() => actions.confirm({ kind: "sign-out", server })}
                />
              )
            );
          })}
        </ItemGroup>
      )}
    </SettingsSectionFrame>
  );
}

function McpServerItem({
  server,
  state,
  disabled,
  install,
  uninstall,
  signIn,
  signOut,
}: {
  server: Server;
  state: McpServerSetup;
  disabled: boolean;
  install: () => void;
  uninstall: () => void;
  signIn: () => void;
  signOut: () => void;
}) {
  const ready = state.status === "ready";
  const logo = SERVER_LOGOS[server.id];
  // Only the name and its actions; a line appears only for a configuration problem the user must fix in Pi.
  return (
    <Item variant="outline" className="flex-nowrap rounded-xl px-4 sm:px-5">
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
          {ready && (!state.oauth || state.signedIn) && (
            <>
              <CheckCircle2Icon className="size-3.5 text-brand" aria-hidden />
              <span className="sr-only">(Ready)</span>
            </>
          )}
        </ItemTitle>
        {state.detail && (
          <ItemDescription className="line-clamp-none">{state.detail}</ItemDescription>
        )}
      </ItemContent>
      <ItemActions className="shrink-0">
        {state.status === "missing" && (
          <Button
            size="sm"
            disabled={disabled}
            aria-label={`Install ${server.name} MCP`}
            onClick={install}
          >
            Install
          </Button>
        )}
        {ready &&
          state.oauth &&
          (state.signedIn ? (
            <Button
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
              size="sm"
              disabled={disabled}
              aria-label={`Sign in to ${server.name}`}
              onClick={signIn}
            >
              Sign in
            </Button>
          ))}
        {state.removalKey && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={disabled}
            aria-label={`Uninstall ${server.name} MCP`}
            onClick={uninstall}
          >
            Uninstall
          </Button>
        )}
      </ItemActions>
    </Item>
  );
}
