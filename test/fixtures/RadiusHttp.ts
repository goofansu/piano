/** In-process HTTP adapter for the real MCP SDK. Never forwards a request to the network. */
import assert from "node:assert/strict";

export const radiusCanary = "fake-radius-credential-DO-NOT-DISCLOSE";
const operations = [
  "artifacts.create",
  "artifacts.versions.publish",
  "artifacts.read",
  "artifacts.versions.read",
  "artifacts.files.download",
];
export class RadiusHttp {
  artifacts = new Map<
    string,
    {
      id: string;
      canonical_url: string;
      latest_version: number;
      visibility: string;
      expires_at: string;
      title: string;
      versions: { note: string; content: string; content_type: string }[];
    }
  >();
  writes: { operation: string; args: Record<string, unknown> }[] = [];
  fail: "none" | "lost-create" | "lost-update" | "rejected-update" | "malformed-create" = "none";
  denied = false;
  wrongIdentity = false;
  unsafeUrl = false;
  unavailable = false;
  unadvertised = new Set<string>();

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://radius.pi.dev", "no test request may leave the adapter");
    assert.equal(init?.redirect, "error", "credentials must not follow redirects");
    if (url.pathname === "/transfer") {
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      assert.equal(url.searchParams.get("secret"), radiusCanary);
      return new Response(
        this.artifacts.get(url.searchParams.get("id")!)!.versions[
          Number(url.searchParams.get("revision")) - 1
        ].content,
      );
    }
    assert.equal(url.pathname, "/mcp");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${radiusCanary}`);
    if (this.denied) return new Response(radiusCanary, { status: 401 });
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (!init?.body) return new Response(null, { status: 202 });
    const body = JSON.parse(String(init.body));
    if (!body.id && body.id !== 0) return new Response(null, { status: 202 });
    const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    if (body.method === "initialize")
      return reply({
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-radius", version: "1" },
      });
    if (body.method === "tools/list")
      return reply({
        tools: operations
          .filter((name) => !this.unadvertised.has(name))
          .map((name) => ({ name, inputSchema: { type: "object" } })),
      });
    if (body.method !== "tools/call") return reply({});
    const { name, arguments: args } = body.params;
    const tool = (value: unknown) =>
      reply({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
    const rejected = () =>
      reply({ isError: true, content: [{ type: "text", text: radiusCanary }] });
    if (this.unavailable) throw new Error(radiusCanary);
    if (name === "artifacts.create" || name === "artifacts.versions.publish") {
      this.writes.push({ operation: name, args });
      if (this.fail === "rejected-update" && name === "artifacts.versions.publish")
        return rejected();
      const id = args.slug ?? `artifact-${this.artifacts.size + 1}`;
      const artifact = this.artifacts.get(id) ?? {
        id,
        canonical_url: `https://radius.pi.dev/artifacts/${id}`,
        latest_version: 0,
        visibility: args.visibility ?? "public",
        expires_at: "2027-01-01T00:00:00Z",
        title: args.title,
        versions: [] as { note: string; content: string; content_type: string }[],
      };
      artifact.latest_version++;
      artifact.title = args.title;
      artifact.versions.push({
        note: args.note,
        content: args.content,
        content_type: args.content_type,
      });
      this.artifacts.set(id, artifact);
      if (
        (name === "artifacts.create" && this.fail === "lost-create") ||
        (name === "artifacts.versions.publish" && this.fail === "lost-update")
      )
        throw new Error(radiusCanary);
      if (this.fail === "malformed-create") return tool({ ok: true, artifact: { id } });
      return tool({ ok: true, artifact });
    }
    const artifact = this.artifacts.get(args.slug);
    if (!artifact) return rejected();
    if (name === "artifacts.read")
      return tool({
        ok: true,
        artifact: {
          ...artifact,
          ...(this.wrongIdentity ? { id: "other-artifact" } : {}),
          ...(this.unsafeUrl ? { canonical_url: `https://attacker.example/${radiusCanary}` } : {}),
        },
      });
    const version = Number(args.version);
    const revision = artifact.versions[version - 1];
    if (!revision) return rejected();
    if (name === "artifacts.versions.read")
      return tool({
        ok: true,
        artifact_id: artifact.id,
        version,
        note: revision.note,
        files: [
          {
            path: "index.md",
            content_type: revision.content_type,
            stored_bytes: Buffer.byteLength(revision.content),
          },
        ],
      });
    if (name === "artifacts.files.download")
      return tool({
        method: "GET",
        headers: {},
        url: `https://radius.pi.dev/transfer?id=${artifact.id}&revision=${version}&secret=${radiusCanary}`,
        expires_at: "2027-01-01T00:00:00Z",
      });
    throw new Error("Unexpected fixture operation");
  };
}
