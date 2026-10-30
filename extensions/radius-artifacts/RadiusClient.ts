/** Radius's official MCP transport, independent of Piano and its sharing policy.
 * Tokens and transfer URLs stay inside this adapter. No mutation is retried.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

const endpoint = "https://radius.pi.dev/mcp";
export class RadiusError extends Error {}
const invalid = () => new RadiusError("Radius returned an invalid artifact response.");
const identifier = z.string().min(1).max(256);
export const Artifact = z.object({
  id: identifier,
  canonical_url: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        !url.search &&
        !url.hash &&
        ["radius.pi.dev", "radius.earendil.com"].includes(url.hostname)
      );
    }),
  latest_version: z.number().int().nonnegative(),
  visibility: z.enum(["private", "organization", "public"]),
  expires_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  title: z.string().nullable(),
});
export type Artifact = z.infer<typeof Artifact>;
const Revision = z.object({
  artifact_id: identifier,
  version: z.number().int().positive(),
  note: z.string().nullable(),
  files: z.array(
    z.object({
      path: z.string(),
      content_type: z.string(),
      stored_bytes: z.number().int().nonnegative(),
    }),
  ),
});

export class RadiusClient {
  private readonly client = new Client({ name: "pi-radius-artifacts", version: "0.1.0" });
  private readonly names = new Map<string, string>();
  private readonly signal: AbortSignal;
  private readonly transport: StreamableHTTPClientTransport;

  constructor(token: string, signal?: AbortSignal) {
    this.signal = AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]);
    this.transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { authorization: `Bearer ${token}` }, redirect: "error" },
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1,
      },
      fetch: async (url, init) => {
        // Also cover the SDK's optional GET stream; never forward a bearer on redirect.
        const response = await fetch(url, {
          ...init,
          redirect: "error",
          signal: init?.signal ? AbortSignal.any([this.signal, init.signal]) : this.signal,
        });
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel();
          throw new RadiusError(
            "Radius authentication or permission failed. Sign in to Radius and check access.",
          );
        }
        return response;
      },
    });
  }

  async connect() {
    await this.client.connect(this.transport, { signal: this.signal, timeout: 30_000 });
    let cursor: string | undefined;
    do {
      const page = await this.client.listTools({ cursor }, { signal: this.signal });
      for (const tool of page.tools) {
        const name = tool.name.replace(/[^a-zA-Z0-9_]/g, "_");
        if (this.names.has(name)) throw invalid();
        this.names.set(name, tool.name);
      }
      cursor = page.nextCursor;
    } while (cursor);
  }

  async close() {
    // A cleanup failure must not erase a confirmed result or expose a provider error.
    await this.client.close().catch(() => {});
  }

  /** Radius's name for an advertised operation. Throwing here proves nothing was sent. */
  operation(name: string): string {
    const actual = this.names.get(name);
    if (!actual)
      throw new RadiusError("Radius does not advertise the required artifact operation.");
    return actual;
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const actual = this.operation(name);
    const result = await this.client.callTool({ name: actual, arguments: args }, undefined, {
      signal: this.signal,
      timeout: 30_000,
    });
    if (result.isError)
      throw new RadiusError(
        "Radius rejected the artifact operation. Check Radius authentication and permissions; no local fallback was made.",
      );
    if (result.structuredContent) return result.structuredContent;
    const content = result.content;
    if (Array.isArray(content) && content.length === 1 && content[0].type === "text") {
      try {
        return JSON.parse(content[0].text);
      } catch {
        throw invalid();
      }
    }
    throw invalid();
  }

  async artifact(name: string, args: Record<string, unknown>) {
    const result = z
      .object({ ok: z.literal(true), artifact: Artifact })
      .safeParse(await this.call(name, args));
    if (!result.success) throw invalid();
    return result.data.artifact;
  }

  read(id: string) {
    return this.artifact("artifacts_read", { slug: id });
  }

  async revision(id: string, version: number) {
    const result = Revision.safeParse(
      await this.call("artifacts_versions_read", { slug: id, version: String(version) }),
    );
    if (!result.success || result.data.artifact_id !== id || result.data.version !== version)
      throw invalid();
    return result.data;
  }

  async content(id: string, version: number, path: string) {
    const transfer = z
      .object({
        method: z.literal("GET"),
        url: z.string().url(),
        headers: z.record(z.string(), z.string()),
      })
      .safeParse(
        await this.call("artifacts_files_download", { slug: id, version: String(version), path }),
      );
    if (!transfer.success) throw invalid();
    const url = new URL(transfer.data.url);
    // Radius issues the one-use credential. Only Radius-hosted transfers are supported; fail
    // closed if the service introduces a new storage host instead of sending secrets elsewhere.
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !["radius.pi.dev", "radius.earendil.com"].includes(url.hostname)
    )
      throw invalid();
    const response = await fetch(url, {
      method: "GET",
      headers: transfer.data.headers,
      redirect: "error",
      signal: this.signal,
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new RadiusError("Radius artifact content could not be read.");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 128 * 1024)
          throw new RadiusError(
            "Artifact content exceeds the 128 KiB view limit; open its Radius viewing URL.",
          );
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks).toString("utf8");
  }
}

export function safeError(error: unknown): string {
  return error instanceof RadiusError
    ? error.message
    : "Radius request failed or was interrupted. Provider details were withheld.";
}
