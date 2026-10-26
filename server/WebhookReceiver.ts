import { lookup } from "node:dns";
import { request } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

const refusal = "Use a public HTTPS URL without credentials or a fragment.";

function publicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  // Reject mapped IPv4 and transition mechanisms as well as special-use ranges.
  return (
    parsed.range() === "unicast" &&
    (parsed.kind() === "ipv4" || parsed.match(ipaddr.parse("2000::"), 3))
  );
}

/** Syntactic checks at save time; DNS is checked at connection time, never trusted from a save. */
export function webhookReceiver(text: string): URL {
  const url = new URL(text);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const name = hostname.toLowerCase().replace(/\.$/, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    name === "localhost" ||
    name.endsWith(".localhost") ||
    (isIP(hostname) !== 0 && !publicAddress(hostname))
  )
    throw new Error(refusal);
  return url;
}

/** Webhook-only transport. No proxy, redirect, pooled socket, or second DNS lookup can bypass
 * destination validation. TLS still verifies the original hostname, not the resolved IP.
 * The response body is discarded immediately rather than buffered. */
export const webhookFetch: typeof fetch = async (input, init) => {
  const url = webhookReceiver(String(input));
  return new Promise<Response>((resolve, reject) => {
    const req = request(
      url,
      {
        agent: false,
        method: init?.method,
        headers: Object.fromEntries(new Headers(init?.headers)),
        signal: init?.signal ?? undefined,
        lookup(hostname, options, callback) {
          lookup(hostname, { all: true }, (error, addresses) => {
            if (error) return callback(error, [], undefined);
            if (!addresses.length || addresses.some(({ address }) => !publicAddress(address)))
              return callback(new Error(refusal), [], undefined);
            // Return the checked answers directly to the socket connector (DNS rebinding safe).
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0]!.address, addresses[0]!.family);
          });
        },
      },
      (response) => {
        const status = response.statusCode ?? 500;
        response.destroy();
        if (status >= 300 && status < 400) reject(new Error("Redirects are not followed."));
        else if (status < 200 || status > 599) reject(new Error("Invalid HTTP status."));
        else resolve(new Response(null, { status }));
      },
    );
    req.on("error", reject);
    req.end(init?.body);
  });
};
