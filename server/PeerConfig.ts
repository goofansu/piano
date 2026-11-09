import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";
import { Context, Schema } from "effect";
import { isLoopbackHostname } from "../shared/loopback.ts";

const Config = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  endpoint: Schema.String,
  origin: Schema.String,
});
export type PeerConfig = typeof Config.Type;

/** One explicit startup peer, not a discovery service or a browser-supplied destination. */
export const ConfiguredPeer = Context.Reference<PeerConfig | undefined>("piano/ConfiguredPeer", {
  defaultValue: () => undefined,
});

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
  if (!isAbsolute(file)) throw invalid();
  let peer: PeerConfig;
  try {
    const fd = openSync(file, "r");
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 16 * 1024) throw invalid();
      const buffer = Buffer.alloc(16 * 1024 + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const read = readSync(fd, buffer, bytes, buffer.length - bytes, null);
        if (read === 0) break;
        bytes += read;
      }
      if (bytes === buffer.length) throw invalid();
      peer = Schema.decodeUnknownSync(Schema.fromJsonString(Config))(
        buffer.subarray(0, bytes).toString("utf8"),
        { onExcessProperty: "error" },
      );
    } finally {
      closeSync(fd);
    }
    if (
      !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(peer.id) ||
      peer.id === "local" ||
      peer.name !== peer.name.trim() ||
      peer.name.length === 0 ||
      peer.name.length > 80 ||
      [...peer.name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      throw invalid();
    const endpoint = new URL(peer.endpoint);
    const origin = new URL(peer.origin);
    if (
      endpoint.origin !== peer.endpoint ||
      endpoint.hostname.includes("*") ||
      (endpoint.protocol !== "https:" &&
        !(
          allowHttpLoopbackForTests &&
          endpoint.protocol === "http:" &&
          isLoopbackHostname(endpoint.hostname)
        )) ||
      origin.origin !== peer.origin ||
      origin.hostname.includes("*") ||
      !["http:", "https:"].includes(origin.protocol)
    )
      throw invalid();
    return peer;
  } catch {
    // Neither file contents, endpoint credentials nor filesystem errors reach diagnostics.
    throw invalid();
  }
}
