import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";
import { Context, Redacted, Schema } from "effect";
import { isLoopbackHostname } from "../shared/loopback.ts";

const Config = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  endpoint: Schema.String,
  origin: Schema.String,
  vmTokenFile: Schema.optional(Schema.String),
});
/** Startup-owned credential, not a browser header or an environment variable passed to Pi. */
export type PeerConfig = Omit<typeof Config.Type, "vmTokenFile"> & {
  readonly vmToken?: Redacted.Redacted<string>;
};

const ConfigFile = Schema.Union([Config, Schema.Struct({ peers: Schema.Array(Config) })]);

/** Explicit startup destinations, not discovery or browser-supplied endpoints. */
export const ConfiguredPeers = Context.Reference<readonly PeerConfig[]>("piano/ConfiguredPeers", {
  defaultValue: () => [],
});

/** Bound reads on the opened descriptor; a token must be a private, owned, non-symlink file. */
function readConfigFile(file: string, secret = false): string {
  if (!isAbsolute(file)) throw new Error();
  const fd = openSync(
    file,
    constants.O_RDONLY | constants.O_NONBLOCK | (secret ? constants.O_NOFOLLOW : 0),
  );
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 16 * 1024) throw new Error();
    if (secret && process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))
      throw new Error();
    const buffer = Buffer.alloc(16 * 1024 + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const read = readSync(fd, buffer, bytes, buffer.length - bytes, null);
      if (read === 0) break;
      bytes += read;
    }
    if (bytes === buffer.length) throw new Error();
    return buffer.subarray(0, bytes).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** Called before startup side effects. Invalid configuration never degrades to Local. */
export function loadPeerConfigs(
  file: string | undefined,
  { allowHttpLoopbackForTests = false } = {},
): readonly PeerConfig[] {
  if (file === undefined) return [];
  const invalid = () =>
    new Error(
      "PIANO_PEER_CONFIG must name an absolute JSON file containing a peer or { peers: [...] } (at most 32), with unique IDs and display names, valid HTTPS endpoints and explicit HTTP(S) origins. Local is reserved.",
    );
  let entries: readonly (typeof Config.Type)[];
  try {
    const document = Schema.decodeUnknownSync(Schema.fromJsonString(ConfigFile))(
      readConfigFile(file),
      {
        onExcessProperty: "error",
      },
    );
    entries = "peers" in document ? document.peers : [document];
    if (entries.length > 32) throw invalid();
    const ids = new Set(["local"]);
    const names = new Set(["local"]);
    for (const entry of entries) {
      const name = entry.name.toLowerCase();
      if (ids.has(entry.id) || names.has(name)) throw invalid();
      ids.add(entry.id);
      names.add(name);
    }
  } catch {
    throw invalid();
  }
  // Validate and load every entry before startup: a bad peer cannot leave a partial configuration.
  return entries.map((configured) => {
    try {
      if (
        !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(configured.id) ||
        configured.id === "local" ||
        configured.id.includes("--") ||
        configured.name !== configured.name.trim() ||
        configured.name.length === 0 ||
        configured.name.length > 80 ||
        [...configured.name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      )
        throw invalid();
      const endpoint = new URL(configured.endpoint);
      const origin = new URL(configured.origin);
      if (
        endpoint.origin !== configured.endpoint ||
        endpoint.hostname.includes("*") ||
        (endpoint.protocol !== "https:" &&
          !(
            allowHttpLoopbackForTests &&
            endpoint.protocol === "http:" &&
            isLoopbackHostname(endpoint.hostname)
          )) ||
        origin.origin !== configured.origin ||
        origin.hostname.includes("*") ||
        !["http:", "https:"].includes(origin.protocol)
      )
        throw invalid();
    } catch {
      // Neither file contents, endpoint credentials nor filesystem errors reach diagnostics.
      throw invalid();
    }
    const { vmTokenFile, ...peer } = configured;
    if (vmTokenFile === undefined) return peer;
    try {
      const endpoint = new URL(peer.endpoint);
      // VM credentials must not accidentally go to an integration, third party or cleartext host.
      // The explicit loopback exception is only for fixtures with dummy credentials.
      if (
        !(
          endpoint.protocol === "https:" &&
          /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.exe\.xyz$/.test(endpoint.hostname)
        ) &&
        !(allowHttpLoopbackForTests && isLoopbackHostname(endpoint.hostname))
      )
        throw new Error();
      const token = readConfigFile(vmTokenFile, true).trim();
      // Opaque Bearer credential; exe.dev, not Piano, validates its VM scope and expiry.
      if (!/^[A-Za-z0-9._~+/-]+=*$/.test(token)) throw new Error();
      return { ...peer, vmToken: Redacted.make(token) };
    } catch {
      throw new Error(
        `PIANO_PEER_CONFIG peer "${peer.id}": vmTokenFile requires an absolute owner-only regular file containing one VM token and a direct HTTPS VM endpoint.`,
      );
    }
  });
}
