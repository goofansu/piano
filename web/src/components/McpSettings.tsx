import { MCP_CATALOG, type McpServerSetup, type McpSetupRequest } from "@shared/mcp";
import { CheckCircle2Icon, ServerIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ProviderLoginDialog } from "@/components/ProviderLoginDialog";
import { ProviderSignOutDialog } from "@/components/ProviderSignOutDialog";
import { SettingsHeader } from "@/components/SettingsHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { mcpLogin, mcpSetup } from "@/lib/api";
import { useObservation } from "@/lib/useObservation";

type Server = (typeof MCP_CATALOG)[number];

/** Catalog MCP servers on this machine: install, sign in, sign out and uninstall, all through Pi. */
export function McpSettings({ onMenu }: { onMenu: () => void }) {
  const setup = useObservation("mcp", signal => mcpSetup(undefined, { signal }));
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [login, setLogin] = useState<{ server: Server; key: string }>();
  const [signOut, setSignOut] = useState<Server>();
  // The dialog keeps the last removal's wording while it animates closed.
  const [removal, setRemoval] = useState<{ server: Server; key: string }>();
  const [removalOpen, setRemovalOpen] = useState(false);
  const servers = setup.value?.servers;
  const error = setup.error && !setup.loading ? "Could not load MCP servers. Check your connection and try again." : "";
  const act = async (request: McpSetupRequest, done: string) => {
    setBusy(true); setActionError("");
    try {
      const next = await setup.mutate(async () => mcpSetup(request));
      toast.success(done);
      return next;
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Could not change MCP setup. Refresh before retrying."); }
    finally { setBusy(false); setRemovalOpen(false); setSignOut(undefined); void setup.refresh(); }
  };
  const disabled = busy || setup.loading || !!error;
  return <section aria-label="Settings" className="flex min-h-0 flex-1 flex-col">
    <SettingsHeader title="MCP" titleId="settings-section-title" onMenu={onMenu} />
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-8 lg:p-10">
      <section aria-labelledby="settings-section-title" className="mx-auto flex max-w-2xl flex-col gap-6">
        {(error || actionError) && <Alert variant="destructive"><AlertTitle>MCP setup needs attention</AlertTitle><AlertDescription>{error || actionError}</AlertDescription></Alert>}
        {!servers ? <div role="status"><span className="sr-only">Loading MCP servers…</span><Skeleton className="h-20 w-full rounded-xl" /></div>
          : <ItemGroup className="gap-2">{MCP_CATALOG.map(server => {
            const state = servers.find(s => s.id === server.id);
            return state && <McpServerItem key={server.id} server={server} state={state} disabled={disabled}
              install={() => void act({ action: "install", server: server.id }, `${server.name} MCP installed.`).then(next => {
                // Installing is the decision to use it: go straight on to signing in.
                const installed = next?.servers.find(s => s.id === server.id);
                if (installed?.status === "ready" && installed.oauth && !installed.signedIn) setLogin({ server, key: crypto.randomUUID() });
              })}
              uninstall={() => { setRemoval({ server, key: state.removalKey! }); setRemovalOpen(true); }}
              signIn={() => setLogin({ server, key: crypto.randomUUID() })}
              signOut={() => setSignOut(server)} />;
          })}</ItemGroup>}
      </section>
    </div>
    <Dialog open={removalOpen} onOpenChange={open => { if (!open && !busy) setRemovalOpen(false); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={false} onInteractOutside={event => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Uninstall {removal?.server.name} MCP?</DialogTitle>
          <DialogDescription>Removes {removal?.server.name} MCP and its saved sign-in from Pi on this machine.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setRemovalOpen(false)}>Cancel</Button>
          <Button variant="destructive" disabled={busy} onClick={() => { if (removal && removalOpen) void act({ action: "uninstall", server: removal.server.id, removalKey: removal.key }, `${removal.server.name} MCP uninstalled for new sessions.`); }}>
            {busy && <Spinner data-icon="inline-start" />}Uninstall
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {signOut && <ProviderSignOutDialog name={signOut.name} busy={busy} cancel={() => setSignOut(undefined)} confirm={() => void act({ action: "sign-out", server: signOut.id }, `Signed out of ${signOut.name}.`)} />}
    {login && <ProviderLoginDialog key={login.key} api={mcpLogin} initialProvider={login.server.id}
      providers={[{ id: login.server.id, name: login.server.name, signedIn: false }]}
      close={() => { setLogin(undefined); void setup.refresh(); }} signedIn={() => void setup.refresh()} />}
  </section>;
}

function McpServerItem({ server, state, disabled, install, uninstall, signIn, signOut }: {
  server: Server; state: McpServerSetup; disabled: boolean;
  install: () => void; uninstall: () => void; signIn: () => void; signOut: () => void;
}) {
  const ready = state.status === "ready";
  // Only the name and its actions; a line appears only for a configuration problem the user must fix in Pi.
  return <Item variant="outline" className="flex-nowrap rounded-xl px-4 sm:px-5">
    <ItemMedia variant="icon"><ServerIcon /></ItemMedia>
    <ItemContent className="min-w-0">
      <ItemTitle>
        {server.name}
        {ready && (!state.oauth || state.signedIn) && <><CheckCircle2Icon className="size-3.5 text-brand" aria-hidden /><span className="sr-only">(Ready)</span></>}
      </ItemTitle>
      {state.detail && <ItemDescription className="line-clamp-none">{state.detail}</ItemDescription>}
    </ItemContent>
    <ItemActions className="shrink-0">
      {state.status === "missing" && <Button size="sm" disabled={disabled} aria-label={`Install ${server.name} MCP`} onClick={install}>Install</Button>}
      {ready && state.oauth && (state.signedIn
        ? <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={disabled} aria-label={`Sign out of ${server.name}`} onClick={signOut}>Sign out</Button>
        : <Button size="sm" disabled={disabled} aria-label={`Sign in to ${server.name}`} onClick={signIn}>Sign in</Button>)}
      {state.removalKey && <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={disabled} aria-label={`Uninstall ${server.name} MCP`} onClick={uninstall}>Uninstall</Button>}
    </ItemActions>
  </Item>;
}
