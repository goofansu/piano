/**
 * One thread = one long-lived `pi --mode rpc --session-id <id>` child, driven
 * through the SDK's RpcClient over JSONL. Extension dialogs (select, confirm,
 * input, editor) arrive as extension_ui_request records and are answered by
 * writing extension_ui_response back to the child's stdin.
 */
import type { ChildProcess } from "node:child_process";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { PI_CLI, PI_EXTRA_ARGS } from "./pi-env.ts";
import { findSessionFile } from "./threads.ts";
import { EventBridge, type RawMessage, type RenderMsg, serializeMessages, type WireEvent } from "./wire.ts";

export interface ThreadSpec {
  cwd: string;
  sessionId: string;
  /** "provider/id" as accepted by `pi --model` */
  model?: string;
  /** Display name for a brand-new session */
  name?: string;
}

export interface RunnerState {
  isStreaming: boolean;
  model?: string;
  thinkingLevel?: string;
  sessionName?: string;
  sessionFile?: string;
}

export interface UiRequest {
  type: "extension_ui_request";
  id: string;
  method: string;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
  notifyType?: string;
  [key: string]: unknown;
}

export interface UiResponse {
  id: string;
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

export type RunnerEvent = WireEvent | { type: "ui_request"; request: UiRequest };

const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);

export class RpcRunner {
  readonly spec: ThreadSpec;
  private client: RpcClient | undefined;
  private unsubscribe: (() => void) | undefined;
  private readonly listeners = new Set<(event: RunnerEvent) => void>();

  constructor(spec: ThreadSpec) {
    this.spec = spec;
  }

  onEvent(listener: (event: RunnerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(events: RunnerEvent[]): void {
    for (const event of events) for (const l of this.listeners) l(event);
  }

  async start(): Promise<void> {
    const { cwd, sessionId } = this.spec;
    const file = await findSessionFile(cwd, sessionId);
    const args = ["--session-id", sessionId, ...PI_EXTRA_ARGS];
    if (this.spec.model) args.push("--model", this.spec.model);
    if (this.spec.name && !file) args.push("--name", this.spec.name);

    const client = new RpcClient({ cliPath: PI_CLI, cwd, args });
    const bridge = new EventBridge("r");
    this.unsubscribe = client.onEvent((event) => {
      const record = event as unknown as { type: string };
      if (record.type === "extension_ui_request") {
        const request = record as UiRequest;
        if (DIALOG_METHODS.has(request.method) || request.method === "notify") {
          this.emit([{ type: "ui_request", request }]);
        }
        return;
      }
      this.emit(bridge.handle(event));
    });
    await client.start();
    this.client = client;
  }

  private get live(): RpcClient {
    if (!this.client) throw new Error("runner not started");
    return this.client;
  }

  async prompt(text: string): Promise<void> {
    const client = this.live;
    const state = await client.getState();
    if (state.isStreaming) await client.followUp(text);
    else await client.prompt(text);
  }

  async abort(): Promise<void> {
    await this.live.abort();
  }

  async setModel(ref: string): Promise<void> {
    const slash = ref.indexOf("/");
    if (slash <= 0) throw new Error(`Model must be provider/id, got "${ref}"`);
    await this.live.setModel(ref.slice(0, slash), ref.slice(slash + 1));
  }

  /** Answer an extension dialog. RpcClient has no public method for this record type. */
  respondUi(response: UiResponse): void {
    const child = (this.live as unknown as { process: ChildProcess | null }).process;
    if (!child?.stdin?.writable) throw new Error("pi process is not accepting input");
    child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", ...response })}\n`);
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    const client = this.client;
    this.client = undefined;
    await client?.stop();
  }

  async getMessages(): Promise<RenderMsg[]> {
    const messages = await this.live.getMessages();
    return serializeMessages(messages as unknown as RawMessage[], "r");
  }

  async getState(): Promise<RunnerState> {
    const s = await this.live.getState();
    return {
      isStreaming: s.isStreaming,
      model: s.model ? `${s.model.provider}/${s.model.id}` : undefined,
      thinkingLevel: s.thinkingLevel,
      sessionName: s.sessionName,
      sessionFile: s.sessionFile,
    };
  }
}
