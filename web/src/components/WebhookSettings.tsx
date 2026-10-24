import {
  WEBHOOK_EVENTS,
  type Webhook,
  type WebhookDelivery,
  type WebhookEvent,
} from "@shared/webhooks";
import { MoreHorizontalIcon, PlusIcon, WebhookIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { RemovalDialog } from "@/components/RemovalDialog";
import {
  SettingsList,
  SettingsLoadFailure,
  SettingsSectionFrame,
  SettingsSkeleton,
  settingsRow,
} from "@/components/SettingsSectionFrame";
import { StatusDot, type StatusTone } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { listWebhooks, removeWebhook, saveWebhook, testWebhook } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useObservation } from "@/lib/useObservation";
import { useSetupActions } from "@/lib/useSetupActions";

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** What a delivery's receiver answered: its HTTP status, or the transport failure. */
const deliveryDetail = (result: WebhookDelivery) =>
  result.httpStatus === null ? result.detail : `HTTP ${result.httpStatus}`;

/** The last delivery as one line: its outcome, the HTTP status or the failure, and when. */
export function deliveryFace(
  result: WebhookDelivery | null,
  now: number,
): { tone: StatusTone; text: string } {
  if (!result) return { tone: "muted", text: "No deliveries yet" };
  const outcome = result.status === "delivered" ? "Delivered" : "Failed";
  const detail = deliveryDetail(result);
  return {
    tone: result.status === "delivered" ? "ok" : "err",
    text: [outcome, detail, timeAgo(result.occurredAt, now)].filter(Boolean).join(" · "),
  };
}

/**
 * A test's outcome as a toast: the HTTP status, or the transport failure. A failed delivery is the
 * test's result, so it answers here rather than as the change's failure.
 */
const testToast = (result: WebhookDelivery) => {
  const detail = deliveryDetail(result);
  if (result.status === "delivered") toast.success(`Test delivered${detail ? ` · ${detail}` : ""}`);
  else toast.error(`Test failed${detail ? ` · ${detail}` : ""}`);
};

export function WebhookSettings() {
  const observed = useObservation("webhooks", (signal) => listWebhooks({ signal }));
  const [editing, setEditing] = useState<Webhook | "new" | null>(null);
  // Row changes answer with a toast, failures included; only a failed load stays on the page.
  const actions = useSetupActions<Webhook>({
    refresh: () => void observed.refresh(),
    success: (text) => toast.success(text),
    failure: (text) => toast.error(text),
  });
  const removing = actions.confirmation;
  const busy = actions.running !== undefined;
  // The last-delivery line changes as sessions finish; a short poll keeps it current while open.
  useEffect(() => {
    const timer = setInterval(() => void observed.refresh(), 3000);
    return () => clearInterval(timer);
  }, [observed.refresh]);
  const now = Date.now();
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
        <>
          {editing && (
            <WebhookEditor
              hook={editing === "new" ? undefined : editing}
              close={() => setEditing(null)}
              refresh={() => void observed.refresh()}
            />
          )}
          <RemovalDialog
            open={!!removing}
            title="Delete webhook?"
            description={`Deliveries to ${removing ? host(removing.url) : "this receiver"} stop; its saved token is removed too.`}
            action="Delete"
            progress="Deleting…"
            busy={busy}
            cancel={actions.cancel}
            confirm={() => {
              const hook = removing;
              if (!hook) return;
              void actions.run({
                id: `remove:${hook.id}`,
                run: () => removeWebhook(hook.id),
                done: "Webhook deleted",
                fallback: "Could not delete webhook.",
              });
            }}
          />
        </>
      }
    >
      {/* The failure stays through the poll's re-reads, so it does not flicker into the skeleton;
       * rows already read stay below it. */}
      {observed.error && (
        <SettingsLoadFailure
          title="Could not load webhooks"
          retrying={observed.loading}
          retry={() => void observed.refresh()}
        />
      )}
      {!observed.value ? (
        observed.error ? null : (
          <SettingsSkeleton label="Loading webhooks…" className="flex flex-col gap-2">
            {[0, 1].map((row) => (
              <Skeleton key={row} className="h-14 w-full rounded-lg" />
            ))}
          </SettingsSkeleton>
        )
      ) : observed.value.length === 0 ? (
        <Empty className="border border-dashed border-line py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WebhookIcon />
            </EmptyMedia>
            <EmptyTitle className="text-base">No webhooks</EmptyTitle>
            <EmptyDescription>
              Add one to be told when a session finishes or waits.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <SettingsList>
          {observed.value.map((hook) => (
            <WebhookRow
              key={hook.id}
              hook={hook}
              now={now}
              disabled={busy}
              setActive={(active) =>
                void actions.run({
                  id: `active:${hook.id}`,
                  run: () =>
                    saveWebhook({ id: hook.id, url: hook.url, events: hook.events, active }),
                  done: active ? "Webhook turned on" : "Webhook turned off",
                  fallback: "Could not save webhook.",
                })
              }
              edit={() => setEditing(hook)}
              test={() =>
                void actions.run({
                  id: `test:${hook.id}`,
                  run: async () => testToast(await testWebhook(hook.id)),
                  fallback: "Could not test webhook.",
                })
              }
              remove={() => actions.confirm(hook)}
            />
          ))}
        </SettingsList>
      )}
    </SettingsSectionFrame>
  );
}

/** One receiver: its host, what it subscribes to, its last delivery, and whether it is on. */
function WebhookRow({
  hook,
  now,
  disabled,
  setActive,
  edit,
  test,
  remove,
}: {
  hook: Webhook;
  now: number;
  disabled: boolean;
  setActive: (active: boolean) => void;
  edit: () => void;
  test: () => void;
  remove: () => void;
}) {
  const name = host(hook.url);
  const delivery = deliveryFace(hook.lastDelivery, now);
  return (
    <Item className={settingsRow} data-active={hook.active}>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className={hook.active ? undefined : "text-ink-2"}>
          <span className="truncate">{name}</span>
          {!hook.active && <span className="text-xs font-normal text-ink-3">Off</span>}
        </ItemTitle>
        <ItemDescription className="line-clamp-none font-mono text-xs">
          {hook.events.join(" · ")}
        </ItemDescription>
        <p role="status" className="flex items-center gap-1.5 text-xs text-ink-3">
          <StatusDot tone={delivery.tone} />
          {delivery.text}
        </p>
      </ItemContent>
      <ItemActions className="shrink-0 gap-1">
        <Switch
          size="sm"
          aria-label={`Active ${name}`}
          checked={hook.active}
          disabled={disabled}
          onCheckedChange={setActive}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Webhook actions ${name}`}
              disabled={disabled}
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={edit}>Edit</DropdownMenuItem>
              <DropdownMenuItem onSelect={test}>Test</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={remove}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  );
}

function WebhookEditor({
  hook,
  close,
  refresh,
}: {
  hook?: Webhook;
  close: () => void;
  /** Re-reads the list once a save settles. */
  refresh: () => void;
}) {
  const [url, setUrl] = useState(hook?.url ?? "");
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [events, setEvents] = useState<readonly WebhookEvent[]>(
    hook?.events ?? ["session.completed"],
  );
  const [active, setActive] = useState(hook?.active ?? true);
  const [eventsError, setEventsError] = useState(false);
  // A failed save stays in the open dialog, on its fields; a saved one closes it with a toast.
  const actions = useSetupActions({ refresh, success: (text) => toast.success(text) });
  const busy = actions.running !== undefined;
  const error = actions.error;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!events.length) {
      setEventsError(true);
      return;
    }
    const saved = await actions.run({
      id: "save",
      run: () =>
        saveWebhook({
          id: hook?.id,
          url,
          token: clearToken ? null : token || undefined,
          events,
          active,
        }),
      done: hook ? "Webhook saved" : "Webhook added",
      fallback: "Could not save webhook.",
    });
    if (saved) close();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{hook ? "Edit webhook" : "Add webhook"}</DialogTitle>
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
                placeholder="https://example.com/piano"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="webhook-token">
                Bearer token <span className="font-normal text-ink-3">Optional</span>
              </FieldLabel>
              {/* A saved token shows as a masked placeholder: blank keeps it, typing replaces it,
               * Remove clears it on save (Keep undoes that before saving). */}
              <InputGroup>
                <InputGroupInput
                  id="webhook-token"
                  type="password"
                  autoComplete="new-password"
                  value={token}
                  placeholder={hook?.hasToken && !clearToken ? "••••••••••••••••" : undefined}
                  aria-description={
                    hook?.hasToken && !clearToken ? "A token is saved; blank keeps it." : undefined
                  }
                  onChange={(e) => {
                    setToken(e.target.value);
                    setClearToken(false);
                  }}
                />
                {hook?.hasToken && !token && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton type="button" onClick={() => setClearToken(!clearToken)}>
                      {clearToken ? "Keep" : "Remove"}
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
            </Field>
            <FieldSet>
              <FieldLegend>Events</FieldLegend>
              {/* A compact checklist, as Linear lists resource types: name only, two columns when they fit. */}
              <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {WEBHOOK_EVENTS.map((event) => (
                  <Field
                    key={event}
                    orientation="horizontal"
                    className="items-center gap-2.5"
                    data-invalid={!events.length}
                  >
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
                    <FieldLabel htmlFor={event} className="font-mono font-normal">
                      {event}
                    </FieldLabel>
                  </Field>
                ))}
              </div>
              {eventsError && !events.length && (
                <FieldError role="alert">Select at least one event.</FieldError>
              )}
            </FieldSet>
            <Field orientation="horizontal" className="items-center gap-2.5">
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
              {busy && <Spinner data-icon="inline-start" />}
              {hook ? "Save" : "Add webhook"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
