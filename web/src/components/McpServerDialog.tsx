import type { McpServerEdit, McpServerSetup, McpSetupState } from "@shared/mcp";
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
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
import { Button } from "@/components/ui/button";
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
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ApiError, mcpSetup } from "@/lib/api";
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
            value={pair.key}
            disabled={disabled}
            className="font-mono text-xs"
            onChange={(e) => set(index, { key: e.target.value })}
          />
          <Input
            aria-label={`${addLabel} value ${index + 1}`}
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

/** The pasted `mcpServers` JSON as entries to add, or why it cannot be read. */
export function parseMcpServersJson(
  text: string,
): { servers: { name: string; config: unknown }[] } | { error: string } | undefined {
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
  if (!entries.length) return { error: "No servers to add." };
  return { servers: entries.map(([name, config]) => ({ name, config })) };
}

type Kind = "url" | "command";
type Auth = "oauth" | "header";

/**
 * Add or edit one entry of Pi's global configuration: its fields in place, errors on the field
 * they belong to, Add or Save in the footer. Adding also takes the `mcpServers` JSON a server's
 * README shows, on its JSON tab. A saved Authorization header shows as a masked placeholder:
 * blank keeps it, typing replaces it, Remove clears it on save.
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
  /** The setup after a successful save, with the names saved. */
  saved: (state: McpSetupState, names: readonly string[]) => void;
}) {
  const config = entry?.config;
  const [tab, setTab] = useState<"form" | "json">("form");
  const [name, setName] = useState(entry?.name ?? "");
  const [kind, setKind] = useState<Kind>(config && "command" in config ? "command" : "url");
  const [url, setUrl] = useState(config && "url" in config ? config.url : "");
  const [auth, setAuth] = useState<Auth>(
    config && "url" in config && config.hasAuthorization ? "header" : "oauth",
  );
  const [authorization, setAuthorization] = useState("");
  const [clearAuthorization, setClearAuthorization] = useState(false);
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
  // The server names the field a refusal belongs to; one without a field shows below the form.
  const [errorField, setErrorField] = useState<string | undefined>();
  const errorAt = (field: string | undefined) =>
    actions.error && errorField === field ? actions.error : undefined;
  const hasAuthorization = !!config && "url" in config && config.hasAuthorization;
  const argList = args
    .split("\n")
    .map((arg) => arg.trim())
    .filter(Boolean);
  const pasted = tab === "json" ? parseMcpServersJson(json) : undefined;

  const run = (request: Parameters<typeof mcpSetup>[0], names: readonly string[], done: string) =>
    actions
      .run({
        id: "save",
        run: () =>
          mcpSetup(request).catch((cause: unknown) => {
            setErrorField(cause instanceof ApiError ? cause.field : undefined);
            throw cause;
          }),
        done,
        fallback: "Could not save MCP server.",
      })
      .then((state) => {
        if (!state) return;
        close();
        saved(state, names);
      });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pasted) {
      if ("error" in pasted) return;
      const names = pasted.servers.map((server) => server.name);
      void run(
        { action: "add", servers: pasted.servers },
        names,
        `${names.join(", ")} MCP added for new sessions.`,
      );
      return;
    }
    const trimmed = name.trim();
    if (entry) {
      const edit: McpServerEdit =
        kind === "url"
          ? {
              url,
              headers: record(headers),
              ...(auth === "header"
                ? clearAuthorization
                  ? { authorization: null }
                  : authorization
                    ? { authorization }
                    : {}
                : { authorization: null }),
            }
          : {
              command,
              args: argList,
              env: record(env),
              ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
            };
      void run(
        {
          action: "update",
          name: entry.name,
          removalKey: entry.removalKey,
          ...(trimmed !== entry.name ? { rename: trimmed } : {}),
          config: edit,
        },
        [trimmed],
        `${trimmed} MCP saved for new sessions.`,
      );
      return;
    }
    const headerRecord = {
      ...(auth === "header" && authorization ? { Authorization: authorization } : {}),
      ...record(headers),
    };
    const added =
      kind === "url"
        ? { url, ...(Object.keys(headerRecord).length ? { headers: headerRecord } : {}) }
        : {
            command,
            ...(argList.length ? { args: argList } : {}),
            ...(Object.keys(record(env)).length ? { env: record(env) } : {}),
            ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
          };
    void run(
      { action: "add", servers: [{ name: trimmed, config: added }] },
      [trimmed],
      `${trimmed} MCP added for new sessions.`,
    );
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
          <DialogTitle>{entry ? "Edit MCP server" : "Add MCP server"}</DialogTitle>
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
                {pasted && "error" in pasted && (
                  <FieldError role="alert">{pasted.error}</FieldError>
                )}
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
                        <SelectItem value="oauth">Sign in</SelectItem>
                        <SelectItem value="header">Authorization header</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {auth === "header" && (
                    <Field>
                      <FieldLabel htmlFor="mcp-authorization">Authorization header</FieldLabel>
                      <InputGroup>
                        <InputGroupInput
                          id="mcp-authorization"
                          type="password"
                          autoComplete="new-password"
                          value={authorization}
                          disabled={busy}
                          placeholder={
                            hasAuthorization && !clearAuthorization
                              ? "••••••••••••••••"
                              : "Bearer …"
                          }
                          aria-description={
                            hasAuthorization && !clearAuthorization
                              ? "A header is saved; blank keeps it."
                              : undefined
                          }
                          onChange={(e) => {
                            setAuthorization(e.target.value);
                            setClearAuthorization(false);
                          }}
                        />
                        {hasAuthorization && !authorization && (
                          <InputGroupAddon align="inline-end">
                            <InputGroupButton
                              type="button"
                              disabled={busy}
                              onClick={() => setClearAuthorization(!clearAuthorization)}
                            >
                              {clearAuthorization ? "Keep" : "Remove"}
                            </InputGroupButton>
                          </InputGroupAddon>
                        )}
                      </InputGroup>
                    </Field>
                  )}
                  <FieldSet>
                    <FieldLegend>Headers</FieldLegend>
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
                    <FieldLegend>Environment</FieldLegend>
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
                      className="font-mono text-xs"
                      onChange={(e) => setCwd(e.target.value)}
                    />
                  </Field>
                </>
              )}
              {errorAt(undefined) && <FieldError role="alert">{errorAt(undefined)}</FieldError>}
            </FieldGroup>
          )}
          <DialogFooter>
            {pasted && "servers" in pasted && (
              <span className="mr-auto self-center text-xs text-ink-3">
                Adds {pasted.servers.map((server) => server.name).join(", ")}
              </span>
            )}
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || (tab === "json" && !(pasted && "servers" in pasted))}
            >
              {busy && <Spinner data-icon="inline-start" />}
              {entry ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
