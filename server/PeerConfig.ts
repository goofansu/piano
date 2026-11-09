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

/** One explicit startup peer, not a discovery service or a browser-supplied destination. */
export const ConfiguredPeer = Context.Reference<PeerConfig | undefined>("piano/ConfiguredPeer", {
  defaultValue: () => undefined,
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
export function loadPeerConfig(
  file: string | undefined,
  { allowHttpLoopbackForTests = false } = {},
): PeerConfig | undefined {
  if (file === undefined) return undefined;
  const invalid = () =>
    new Error(
      "PIANO_PEER_CONFIG must name an absolute JSON file with a valid peer id, name, HTTPS endpoint and explicit HTTP(S) origin.",
    );
  let configured: typeof Config.Type;
  try {
    configured = Schema.decodeUnknownSync(Schema.fromJsonString(Config))(readConfigFile(file), {
      onExcessProperty: "error",
    });
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
      "PIANO_PEER_CONFIG vmTokenFile requires an absolute owner-only regular file containing one VM token and a direct HTTPS VM endpoint such as https://eng-1.exe.xyz:3000.",
    );
  }
}
