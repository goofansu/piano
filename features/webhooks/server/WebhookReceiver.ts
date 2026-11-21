import { lookup } from "node:dns";
import { request } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

export const RECEIVER_RULE = "Use a public HTTPS URL without credentials or a fragment.";
export const REDIRECT_REFUSED = "Receiver redirected.";
export const INVALID_STATUS = "Receiver returned an invalid HTTP status.";

export class ReceiverRefusal extends Error {
  override readonly name = "ReceiverRefusal";
}

function publicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  return (
    parsed.range() === "unicast" &&
    (parsed.kind() === "ipv4" || parsed.match(ipaddr.parse("2000::"), 3))
  );
}

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
    throw new ReceiverRefusal(RECEIVER_RULE);
  return url;
}

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
              return callback(new ReceiverRefusal(RECEIVER_RULE), [], undefined);
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0]!.address, addresses[0]!.family);
          });
        },
      },
      (response) => {
        const status = response.statusCode ?? 500;
        response.destroy();
        if (status >= 300 && status < 400) reject(new ReceiverRefusal(REDIRECT_REFUSED));
        else if (status < 200 || status > 599) reject(new ReceiverRefusal(INVALID_STATUS));
        else resolve(new Response(null, { status }));
      },
    );
    req.on("error", reject);
    req.end(init?.body);
  });
};
