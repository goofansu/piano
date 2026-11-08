import { LITERAL_SECRET_MAX } from "@shared/literalSecret";
import {
  WEBHOOK_EVENTS,
  WEBHOOK_FIELDS,
  type Webhook,
  type WebhookDelivery,
  type WebhookEvent,
} from "@shared/webhooks";
import { WebhookIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormDialog, useFieldRefusal } from "@/components/FormDialog";
import { PageHeaderActions } from "@/components/PageHeaderActions";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/PianoDialog";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/PianoDropdownMenu";
import { RemovalDialog } from "@/components/RemovalDialog";
import { ListRow, RowMenu, RowStatus } from "@/components/RowActions";
import { SavedSecretInput, useSavedSecret } from "@/components/SavedSecretInput";
import {
  SettingsList,
  SettingsLoadState,
  SettingsSectionFrame,
} from "@/components/SettingsSectionFrame";
import type { StatusTone } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ItemDescription } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { listWebhooks, removeWebhook, saveWebhook, testWebhook } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { PAGE_EDITORS } from "@/lib/pageEditor";
import { settingsLoadView } from "@/lib/settingsLoadView";
import { useObservation } from "@/lib/useObservation";
import { useSetupActions } from "@/lib/useSetupActions";

const webhookEditor = PAGE_EDITORS.webhooks.editor;

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
  // New webhook comes from `pageCommands` (the header and the palette); both open this editor.
  const editing = webhookEditor.useEditing();
  // Row changes answer with a toast, failures included; only a failed load stays on the page.
  const actions = useSetupActions<Webhook>({
    refresh: () => void observed.refresh(),
    success: (text) => toast.success(text),
  });
  const removing = actions.confirmation;
  const busy = actions.running !== undefined;
  // The last-delivery line changes as sessions finish; a short poll keeps it current while open.
  useEffect(() => {
    const timer = setInterval(() => void observed.refresh(), 3000);
    return () => clearInterval(timer);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the poll restarts only when refresh changes.
  }, [observed.refresh]);
  const now = Date.now();
  return (
    <SettingsSectionFrame
      title="Webhooks"
      actions={<PageHeaderActions page="settings" />}
      dialogs={
        <>
          {editing && (
            <WebhookEditor
              key={editing.key}
              hook={editing.target === "new" ? undefined : editing.target}
              close={webhookEditor.close}
              refresh={() => void observed.refresh()}
            />
          )}
          <RemovalDialog
            open={!!removing}
            title="Delete webhook?"
            description={`Deliveries to ${removing ? host(removing.url) : "this receiver"} stop, and its saved token is deleted.`}
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
      <SettingsLoadState
        view={settingsLoadView({ ...observed, isEmpty: (hooks) => hooks.length === 0 })}
        noun="webhooks"
        retry={() => void observed.refresh()}
        emptyIcon={WebhookIcon}
      >
        {(hooks) => (
          <SettingsList>
            {hooks.map((hook) => (
              <WebhookRow
                key={hook.id}
                hook={hook}
                now={now}
                disabled={busy}
                setActive={(active) =>
                  void actions.run({
                    id: `active:${hook.id}`,
                    // Only what the switch changes: the row may predate an edit made elsewhere.
                    run: () => saveWebhook({ id: hook.id, active }),
                    done: active ? "Webhook turned on" : "Webhook turned off",
                    fallback: "Could not save webhook.",
                  })
                }
                edit={() => webhookEditor.open(hook)}
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
      </SettingsLoadState>
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
    <ListRow
      data-active={hook.active}
      title={<span className="truncate">{name}</span>}
      titleClassName={hook.active ? undefined : "text-ink-2"}
      // Interactive controls keep their own hit targets beside the menu.
      actions={
        <Switch
          size="sm"
          aria-label={`Active ${name}`}
          checked={hook.active}
          disabled={disabled}
          onCheckedChange={setActive}
        />
      }
      menu={
        <RowMenu label={`Webhook actions ${name}`} disabled={disabled}>
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={edit}>Edit</DropdownMenuItem>
            <DropdownMenuItem onSelect={test}>Test</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={remove}>
            Delete
          </DropdownMenuItem>
        </RowMenu>
      }
    >
      <ItemDescription className="line-clamp-none font-mono text-xs">
        {hook.events.join(" · ")}
      </ItemDescription>
      <RowStatus role="status" tone={delivery.tone}>
        {delivery.text}
      </RowStatus>
    </ListRow>
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
  const token = useSavedSecret(hook?.hasToken ?? false);
  const [events, setEvents] = useState<readonly WebhookEvent[]>(
    hook?.events ?? ["session.completed"],
  );
  const [active, setActive] = useState(hook?.active ?? true);
  // A failed save stays in the open dialog, on its fields; a saved one closes it with a toast.
  const actions = useSetupActions({
    refresh,
    success: (text) => toast.success(text),
    failure: "keep",
  });
  const busy = actions.running !== undefined;
  // The server names the field a refusal belongs to; one without a field shows below the form.
  const refusal = useFieldRefusal(WEBHOOK_FIELDS, actions.error);
  const urlError = refusal.at("url");
  const tokenError = refusal.at("token");
  // Create and Save wait for a URL and at least one event, as New skill waits for its draft.
  const ready = url.trim() !== "" && events.length > 0;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    const saved = await actions.run({
      id: "save",
      run: () =>
        saveWebhook({
          id: hook?.id,
          url,
          token: token.change,
          events,
          active,
        }).catch(refusal.record),
      done: hook ? "Webhook saved" : "Webhook created",
      fallback: "Could not save webhook.",
    });
    if (saved) close();
  };
  return (
    <FormDialog
      busy={busy}
      close={close}
      className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
      aria-describedby={undefined}
    >
      <DialogHeader>
        <DialogTitle>{hook ? "Edit webhook" : "New webhook"}</DialogTitle>
      </DialogHeader>
      <form className="flex flex-col gap-6" onSubmit={(e) => void submit(e)}>
        <FieldGroup>
          <Field data-invalid={!!urlError}>
            <FieldLabel htmlFor="webhook-url">URL</FieldLabel>
            <Input
              id="webhook-url"
              type="url"
              required
              value={url}
              aria-invalid={!!urlError}
              onChange={(e) => setUrl(e.target.value)}
            />
            {urlError && <FieldError role="alert">{urlError}</FieldError>}
          </Field>
          <Field data-invalid={!!tokenError}>
            <FieldLabel htmlFor="webhook-token">
              Bearer token <span className="font-normal text-ink-3">Optional</span>
            </FieldLabel>
            <SavedSecretInput
              secret={token}
              id="webhook-token"
              noun="token"
              maxLength={LITERAL_SECRET_MAX}
              disabled={busy}
              invalid={!!tokenError}
            />
            {tokenError && <FieldError role="alert">{tokenError}</FieldError>}
          </Field>
          <FieldSet>
            <FieldLegend variant="label">Events</FieldLegend>
            {/* A compact checklist, as Linear lists resource types: name only, two columns when they fit. */}
            <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {WEBHOOK_EVENTS.map((event) => (
                <Field key={event} orientation="horizontal" className="items-center gap-2.5">
                  <Checkbox
                    id={event}
                    checked={events.includes(event)}
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
          </FieldSet>
          <Field orientation="horizontal" className="items-center gap-2.5">
            <Switch id="webhook-active" checked={active} onCheckedChange={setActive} />
            <FieldLabel htmlFor="webhook-active">Active</FieldLabel>
          </Field>
          {refusal.at(undefined) && <FieldError role="alert">{refusal.at(undefined)}</FieldError>}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !ready}>
            {busy && <Spinner data-icon="inline-start" />}
            {hook ? "Save" : "Create webhook"}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  );
}
