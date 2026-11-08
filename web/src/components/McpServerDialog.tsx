import {
  MCP_FIELDS,
  type McpField,
  type McpServerEdit,
  type McpServerSetup,
  type McpSetupChange,
} from "@shared/mcp";
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { FormDialog, useFieldRefusal } from "@/components/FormDialog";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/PianoSelect";
import { SavedSecretInput, useSavedSecret } from "@/components/SavedSecretInput";
import { Button } from "@/components/ui/button";
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
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { changeMcpSetup } from "@/lib/api";
import { useSetupActions } from "@/lib/useSetupActions";

interface Pair {
  key: string;
  value: string;
}
const pairs = (record: Record<string, string>): Pair[] =>
  Object.entries(record).map(([key, value]) => ({ key, value }));
const record = (list: readonly Pair[]) =>
  Object.fromEntries(
    list.filter((pair) => pair.key.trim()).map((pair) => [pair.key.trim(), pair.value]),
  );

/** Key/value rows (headers, environment) with add and remove. */
function KeyValueFields({
  list,
  onChange,
  addLabel,
  disabled,
}: {
  list: Pair[];
  onChange: (list: Pair[]) => void;
  addLabel: string;
  disabled: boolean;
}) {
  const set = (index: number, patch: Partial<Pair>) =>
    onChange(list.map((pair, i) => (i === index ? { ...pair, ...patch } : pair)));
  return (
    <div className="flex flex-col gap-2">
      {list.map((pair, index) => (
        // Rows have no identity until typed, so the index is the key.
        <div key={index} className="flex items-center gap-2">
          <Input
            aria-label={`${addLabel} name ${index + 1}`}
            placeholder="Name"
            value={pair.key}
            disabled={disabled}
            className="font-mono text-xs"
            onChange={(e) => set(index, { key: e.target.value })}
          />
          <Input
            aria-label={`${addLabel} value ${index + 1}`}
            placeholder="Value"
            value={pair.value}
            disabled={disabled}
            autoComplete="off"
            className="font-mono text-xs"
            onChange={(e) => set(index, { value: e.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={`Remove ${pair.key || `row ${index + 1}`}`}
            onClick={() => onChange(list.filter((_, i) => i !== index))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([...list, { key: "", value: "" }])}
        >
          <PlusIcon data-icon="inline-start" />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

/** The pasted `mcpServers` JSON as the one entry to add, or why it cannot be read. */
export function parseMcpServerJson(
  text: string,
): { name: string; config: unknown } | { error: string } | undefined {
  if (!text.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "Not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { error: "Paste an object with mcpServers." };
  const root = parsed as Record<string, unknown>;
  const servers =
    root.mcpServers && typeof root.mcpServers === "object" && !Array.isArray(root.mcpServers)
      ? (root.mcpServers as Record<string, unknown>)
      : root;
  const entries = Object.entries(servers);
  if (!entries.length) return { error: "No server to add." };
  if (entries.length > 1) return { error: "Paste one server at a time." };
  const [[name, config]] = entries as [[string, unknown]];
  return { name, config };
}

type Kind = "url" | "command";
type Auth = "oauth" | "header";

/**
 * Add or edit one entry of Pi's global configuration: its fields in place, errors on the field
 * they belong to, Add MCP server or Save in the footer. Adding also takes the `mcpServers` JSON a server's
 * README shows, one server at a time, on its JSON tab. A URL server is saved only once it
 * connects: one that cannot is refused on its URL, and one that asks for a sign-in closes this
 * dialog for the sign-in, which saves it. A saved Authorization header stays saved until the
 * field replaces or removes it.
 */
export function McpServerDialog({
  entry,
  close,
  refresh,
  saved,
}: {
  /** The entry to edit, or undefined to add. */
  entry?: McpServerSetup;
  close: () => void;
  /** Re-reads the list once a save settles. */
  refresh: () => void;
  /** The change's answer, with the entry's name, once it saved or waits for a sign-in. */
  saved: (reply: McpSetupChange, name: string) => void;
}) {
  const config = entry?.config;
  const [tab, setTab] = useState<"form" | "json">("form");
  const [name, setName] = useState(entry?.name ?? "");
  const [kind, setKind] = useState<Kind>(config && "command" in config ? "command" : "url");
  const [url, setUrl] = useState(config && "url" in config ? config.url : "");
  const [auth, setAuth] = useState<Auth>(
    config && "url" in config && config.hasAuthorization ? "header" : "oauth",
  );
  const authorization = useSavedSecret(!!config && "url" in config && config.hasAuthorization);
  const [headers, setHeaders] = useState<Pair[]>(
    config && "url" in config ? pairs(config.headers) : [],
  );
  const [command, setCommand] = useState(config && "command" in config ? config.command : "");
  const [args, setArgs] = useState(config && "command" in config ? config.args.join("\n") : "");
  const [env, setEnv] = useState<Pair[]>(config && "command" in config ? pairs(config.env) : []);
  const [cwd, setCwd] = useState(config && "command" in config ? (config.cwd ?? "") : "");
  const [json, setJson] = useState("");
  const actions = useSetupActions({
    refresh,
    success: (text) => toast.success(text),
    failure: "keep",
  });
  const busy = actions.running !== undefined;
  // A refusal belongs to the tab that sent it, so switching tabs does not carry it over.
  const refusal = useFieldRefusal(MCP_FIELDS, actions.error);
  const errorAt = (field: McpField | undefined) => refusal.at(field, tab);
  const argList = args
    .split("\n")
    .map((arg) => arg.trim())
    .filter(Boolean);
  const pasted = tab === "json" ? parseMcpServerJson(json) : undefined;
  // Saving a local command starts it once, so say so before the user saves.
  const startsCommand = pasted
    ? "name" in pasted &&
      !!pasted.config &&
      typeof pasted.config === "object" &&
      "command" in pasted.config
    : tab === "form" && kind === "command";

  // The confirm waits for the required fields, as New project does.
  const complete =
    tab === "json"
      ? !!pasted && "name" in pasted
      : !!name.trim() && !!(kind === "url" ? url.trim() : command.trim());

  const run = (request: Parameters<typeof changeMcpSetup>[0], name: string, done: string) =>
    actions
      .run({
        id: "save",
        run: () => changeMcpSetup(request).catch((cause: unknown) => refusal.record(cause, tab)),
        // A server waiting for its sign-in is not saved yet: the sign-in says when it is.
        done: (reply) => (reply.signIn ? undefined : done),
        fallback: "Could not save MCP server.",
      })
      .then((reply) => {
        if (!reply) return;
        close();
        saved(reply, name);
      });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pasted) {
      if ("error" in pasted) return;
      void run(
        { action: "add", name: pasted.name, config: pasted.config },
        pasted.name,
        "MCP server added",
      );
      return;
    }
    const trimmed = name.trim();
    // Adding and editing send the same fields; the server merges them into the entry.
    const form: McpServerEdit =
      kind === "url"
        ? {
            url,
            headers: record(headers),
            ...(auth === "header"
              ? authorization.change === undefined
                ? {}
                : { authorization: authorization.change }
              : { authorization: null }),
          }
        : { command, args: argList, env: record(env), ...(cwd.trim() ? { cwd: cwd.trim() } : {}) };
    if (entry) {
      void run(
        {
          action: "update",
          name: entry.name,
          removalKey: entry.removalKey,
          ...(trimmed !== entry.name ? { rename: trimmed } : {}),
          config: form,
        },
        trimmed,
        "MCP server saved",
      );
      return;
    }
    void run({ action: "add", name: trimmed, form }, trimmed, "MCP server added");
  };

  return (
    <FormDialog
      busy={busy}
      close={close}
      className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
      aria-describedby={startsCommand ? "mcp-starts-command" : undefined}
    >
      <DialogHeader>
        <DialogTitle>{entry ? "Edit MCP server" : "Add MCP server"}</DialogTitle>
        {startsCommand && (
          <DialogDescription id="mcp-starts-command">
            {entry ? "Saving" : "Adding"} runs the command once to check that it starts.
          </DialogDescription>
        )}
      </DialogHeader>
      {!entry && (
        <Tabs value={tab} onValueChange={(value) => setTab(value as "form" | "json")}>
          <TabsList variant="line">
            <TabsTrigger value="form">Form</TabsTrigger>
            <TabsTrigger value="json">JSON</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <form className="flex flex-col gap-6" onSubmit={submit}>
        {tab === "json" ? (
          <FieldGroup>
            <Field data-invalid={!!(pasted && "error" in pasted) || !!errorAt(undefined)}>
              <FieldLabel htmlFor="mcp-json">mcpServers JSON</FieldLabel>
              <Textarea
                id="mcp-json"
                rows={10}
                autoFocus
                value={json}
                disabled={busy}
                className="font-mono text-xs"
                placeholder={JSON.stringify(
                  { mcpServers: { docs: { url: "https://mcp.example.com/mcp" } } },
                  null,
                  2,
                )}
                onChange={(e) => setJson(e.target.value)}
              />
              {pasted && "error" in pasted && <FieldError role="alert">{pasted.error}</FieldError>}
              {(errorAt("name") || errorAt("config") || errorAt(undefined)) && (
                <FieldError role="alert">
                  {errorAt("name") ?? errorAt("config") ?? errorAt(undefined)}
                </FieldError>
              )}
            </Field>
          </FieldGroup>
        ) : (
          <FieldGroup>
            <Field data-invalid={!!errorAt("name")}>
              <FieldLabel htmlFor="mcp-name">Name</FieldLabel>
              <Input
                id="mcp-name"
                required
                autoFocus={!entry}
                value={name}
                disabled={busy}
                aria-invalid={!!errorAt("name")}
                onChange={(e) => setName(e.target.value)}
              />
              {errorAt("name") && <FieldError role="alert">{errorAt("name")}</FieldError>}
            </Field>
            <Field>
              <FieldLabel id="mcp-kind-label">Type</FieldLabel>
              {/* Field stretches its children; the wrapper keeps the group's shadow to its buttons. */}
              <div>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  spacing={0}
                  aria-labelledby="mcp-kind-label"
                  value={kind}
                  disabled={busy}
                  onValueChange={(value) => value && setKind(value as Kind)}
                >
                  <ToggleGroupItem value="url">URL</ToggleGroupItem>
                  <ToggleGroupItem value="command">Command</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </Field>
            {kind === "url" ? (
              <>
                <Field data-invalid={!!errorAt("config")}>
                  <FieldLabel htmlFor="mcp-url">URL</FieldLabel>
                  <Input
                    id="mcp-url"
                    type="url"
                    required
                    value={url}
                    disabled={busy}
                    placeholder="https://mcp.example.com/mcp"
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  {errorAt("config") && <FieldError role="alert">{errorAt("config")}</FieldError>}
                </Field>
                <Field>
                  <FieldLabel htmlFor="mcp-auth">Authentication</FieldLabel>
                  <Select
                    value={auth}
                    onValueChange={(value) => setAuth(value as Auth)}
                    disabled={busy}
                  >
                    <SelectTrigger id="mcp-auth" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="oauth">Sign in if needed</SelectItem>
                      <SelectItem value="header">Authorization header</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {auth === "header" && (
                  <Field>
                    <FieldLabel htmlFor="mcp-authorization">Authorization header</FieldLabel>
                    <SavedSecretInput
                      secret={authorization}
                      id="mcp-authorization"
                      noun="header"
                      placeholder="Bearer …"
                      disabled={busy}
                    />
                  </Field>
                )}
                <FieldSet>
                  <FieldLegend variant="label">Headers</FieldLegend>
                  <KeyValueFields
                    list={headers}
                    onChange={setHeaders}
                    addLabel="Add header"
                    disabled={busy}
                  />
                </FieldSet>
              </>
            ) : (
              <>
                <Field data-invalid={!!errorAt("config")}>
                  <FieldLabel htmlFor="mcp-command">Command</FieldLabel>
                  <Input
                    id="mcp-command"
                    required
                    value={command}
                    disabled={busy}
                    className="font-mono text-xs"
                    onChange={(e) => setCommand(e.target.value)}
                  />
                  {errorAt("config") && <FieldError role="alert">{errorAt("config")}</FieldError>}
                </Field>
                <Field>
                  <FieldLabel htmlFor="mcp-args">
                    Arguments <span className="font-normal text-ink-3">One per line</span>
                  </FieldLabel>
                  <Textarea
                    id="mcp-args"
                    rows={2}
                    value={args}
                    disabled={busy}
                    className="font-mono text-xs"
                    onChange={(e) => setArgs(e.target.value)}
                  />
                </Field>
                <FieldSet>
                  <FieldLegend variant="label">Environment</FieldLegend>
                  <KeyValueFields
                    list={env}
                    onChange={setEnv}
                    addLabel="Add variable"
                    disabled={busy}
                  />
                </FieldSet>
                <Field>
                  <FieldLabel htmlFor="mcp-cwd">
                    Working directory <span className="font-normal text-ink-3">Optional</span>
                  </FieldLabel>
                  <Input
                    id="mcp-cwd"
                    value={cwd}
                    disabled={busy}
                    aria-describedby="mcp-cwd-hint"
                    className="font-mono text-xs"
                    onChange={(e) => setCwd(e.target.value)}
                  />
                  <FieldDescription id="mcp-cwd-hint" className="text-xs text-ink-3">
                    Empty runs the command in each session's folder. Set it only when the command
                    uses relative paths.
                  </FieldDescription>
                </Field>
              </>
            )}
            {errorAt(undefined) && <FieldError role="alert">{errorAt(undefined)}</FieldError>}
          </FieldGroup>
        )}
        <DialogFooter>
          {pasted && "name" in pasted && (
            <span className="mr-auto self-center text-xs text-ink-3">Adds {pasted.name}</span>
          )}
          <Button type="button" variant="outline" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !complete}>
            {busy && <Spinner data-icon="inline-start" />}
            {entry ? "Save" : "Add MCP server"}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  );
}
