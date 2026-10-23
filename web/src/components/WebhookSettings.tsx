import {
  WEBHOOK_EVENTS,
  type Webhook,
  type WebhookDelivery,
  type WebhookEvent,
} from "@shared/webhooks";
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { SettingsAlert, SettingsSectionFrame } from "@/components/SettingsSectionFrame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { listWebhooks, removeWebhook, saveWebhook, testWebhook } from "@/lib/api";
import { useObservation } from "@/lib/useObservation";

const deliveryText = (result: WebhookDelivery | null) =>
  result
    ? `${result.status === "delivered" ? "Delivered" : "Failed"}${result.httpStatus === null ? " — " + result.detail : ` — HTTP ${result.httpStatus}`}`
    : "Not sent yet";

export function WebhookSettings() {
  const observed = useObservation("webhooks", (signal) => listWebhooks({ signal }));
  const [editing, setEditing] = useState<Webhook | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const timer = setInterval(() => void observed.refresh(), 3000);
    return () => clearInterval(timer);
  }, [observed.refresh]);
  const act = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await operation();
      await observed.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change webhook.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSectionFrame
      title="Webhooks"
      actions={
        <Button size="sm" onClick={() => setEditing("new")}>
          <PlusIcon data-icon="inline-start" />
          Add webhook
        </Button>
      }
      dialogs={
        editing && (
          <WebhookEditor
            hook={editing === "new" ? undefined : editing}
            close={() => setEditing(null)}
            saved={() => void observed.refresh()}
          />
        )
      }
    >
      {(error || observed.failure) && (
        <SettingsAlert title="Webhooks need attention">
          {error ?? "Could not load webhooks."}
        </SettingsAlert>
      )}
      {!observed.value ? (
        <p role="status">Loading webhooks…</p>
      ) : observed.value.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No webhooks yet</EmptyTitle>
            <EmptyDescription>Send selected session events to your receiver.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup className="gap-2">
          {observed.value.map((hook) => (
            <Item key={hook.id} variant="outline">
              <ItemContent className="min-w-0">
                <ItemTitle>{new URL(hook.url).host}</ItemTitle>
                <div className="flex flex-wrap gap-1">
                  {hook.events.map((event) => (
                    <Badge key={event} variant="secondary">
                      {event}
                    </Badge>
                  ))}
                </div>
                <ItemDescription role="status">{deliveryText(hook.lastDelivery)}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Switch
                  aria-label={`Active ${new URL(hook.url).host}`}
                  checked={hook.active}
                  disabled={busy}
                  onCheckedChange={(active) =>
                    void act(() =>
                      saveWebhook({ id: hook.id, url: hook.url, events: hook.events, active }),
                    )
                  }
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Webhook actions ${new URL(hook.url).host}`}
                      disabled={busy}
                    >
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onSelect={() => setEditing(hook)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void act(() => testWebhook(hook.id))}>
                        Send test
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => void act(() => removeWebhook(hook.id))}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
    </SettingsSectionFrame>
  );
}

function WebhookEditor({
  hook,
  close,
  saved,
}: {
  hook?: Webhook;
  close: () => void;
  saved: () => void;
}) {
  const [url, setUrl] = useState(hook?.url ?? "");
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [events, setEvents] = useState<readonly WebhookEvent[]>(
    hook?.events ?? ["session.completed"],
  );
  const [active, setActive] = useState(hook?.active ?? true);
  const [eventsError, setEventsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!events.length) {
      setEventsError(true);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await saveWebhook({
        id: hook?.id,
        url,
        token: clearToken ? null : token || undefined,
        events,
        active,
      });
      setToken("");
      saved();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save webhook.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{hook ? "Edit webhook" : "Add webhook"}</DialogTitle>
          <DialogDescription>Send session events to a receiver you trust.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-6" onSubmit={(e) => void submit(e)}>
          <FieldGroup>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="webhook-url">URL</FieldLabel>
              <Input
                id="webhook-url"
                type="url"
                required
                value={url}
                aria-invalid={!!error}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/webhook"
              />
              <FieldDescription>HTTPS required; HTTP is allowed on loopback.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="webhook-token">Bearer token (optional)</FieldLabel>
              <Input
                id="webhook-token"
                type="password"
                autoComplete="new-password"
                value={token}
                disabled={clearToken}
                onChange={(e) => setToken(e.target.value)}
              />
              <FieldDescription>
                {hook?.hasToken
                  ? "Token saved. Leave blank to keep it, or enter a replacement."
                  : "Stored privately in Piano’s database; never shown again."}
              </FieldDescription>
            </Field>
            {hook?.hasToken && (
              <Field orientation="horizontal">
                <Checkbox
                  id="webhook-clear-token"
                  checked={clearToken}
                  onCheckedChange={(value) => setClearToken(value === true)}
                />
                <FieldLabel htmlFor="webhook-clear-token">Remove saved token</FieldLabel>
              </Field>
            )}
            <FieldSet>
              <FieldLegend>Events</FieldLegend>
              <FieldGroup>
                {WEBHOOK_EVENTS.map((event) => (
                  <Field key={event} orientation="horizontal" data-invalid={!events.length}>
                    <Checkbox
                      id={event}
                      checked={events.includes(event)}
                      aria-invalid={!events.length}
                      onCheckedChange={(checked) =>
                        setEvents(
                          checked === true ? [...events, event] : events.filter((e) => e !== event),
                        )
                      }
                    />
                    <FieldLabel htmlFor={event}>{event}</FieldLabel>
                  </Field>
                ))}
              </FieldGroup>
              {eventsError && !events.length && (
                <FieldError role="alert">Select at least one event.</FieldError>
              )}
            </FieldSet>
            <Field orientation="horizontal">
              <Switch id="webhook-active" checked={active} onCheckedChange={setActive} />
              <FieldLabel htmlFor="webhook-active">Active</FieldLabel>
            </Field>
            {error && <FieldError role="alert">{error}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save webhook"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
