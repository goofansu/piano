import assert from "node:assert/strict";
import dns from "node:dns";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import {
  RECEIVER_RULE,
  REDIRECT_REFUSED,
  ReceiverRefusal,
  webhookFetch,
} from "../server/WebhookReceiver.ts";

/** The transport's own refusal, with the sentence a delivery row shows for it. */
const refusal = (detail: string) => (error: unknown) =>
  error instanceof ReceiverRefusal && error.message === detail;

type LookupCallback = (error: Error | null, addresses: dns.LookupAddress[]) => void;
type Respond = (response: { statusCode: number; destroy: () => void }) => void;

const blocked = [
  "0.0.0.0",
  "127.0.0.1",
  "10.0.0.1",
  "172.16.0.1",
  "192.168.1.1",
  "169.254.169.254",
  "100.64.0.1",
  "192.0.0.1",
  "192.0.2.1",
  "198.18.0.1",
  "198.51.100.1",
  "203.0.113.1",
  "224.0.0.1",
  "240.0.0.1",
  "255.255.255.255",
  "::",
  "::1",
  "fc00::1",
  "fe80::1",
  "ff02::1",
  "::ffff:127.0.0.1",
  "64:ff9b::a00:1",
  "2001:db8::1",
  "2002:7f00:1::",
  "2001::1",
];

test("real HTTPS transport refuses non-public literals and DNS answers before connecting", async (t) => {
  let answers = ["127.0.0.1"];
  t.mock.method(dns, "lookup", (_host: string, _options: unknown, callback: LookupCallback) => {
    callback(
      null,
      answers.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
    );
  });
  syncBuiltinESMExports();
  try {
    for (const address of blocked) {
      const literal = address.includes(":") ? `[${address}]` : address;
      await assert.rejects(webhookFetch(`https://${literal}/`), /public HTTPS/);
      answers = [address];
      await assert.rejects(webhookFetch("https://receiver.example/"), /public HTTPS/);
    }
    answers = ["8.8.8.8", "127.0.0.1"];
    await assert.rejects(webhookFetch("https://receiver.example/"), /public HTTPS/);
    await assert.rejects(webhookFetch("http://8.8.8.8/"), /public HTTPS/);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("public answers reach the connector unchanged; later DNS changes fail, redirects never send again", async (t) => {
  let answers = ["8.8.8.8", "2606:4700:4700::1111"];
  let lookups = 0;
  let status = 204;
  const connected: string[] = [];
  t.mock.method(dns, "lookup", (_host: string, _options: unknown, callback: LookupCallback) => {
    lookups++;
    callback(
      null,
      answers.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
    );
  });
  // Fake only the socket/HTTP boundary; exercise the production resolver and URL policy.
  t.mock.method(https, "request", (url: URL, options: https.RequestOptions, respond: Respond) => {
    assert.equal(url.hostname, "receiver.example", "TLS retains the original hostname");
    assert.equal(options.agent, false);
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      options.lookup!(url.hostname, { all: true }, (error, addresses) => {
        if (error) {
          req.emit("error", error);
          return;
        }
        connected.push(...(addresses as dns.LookupAddress[]).map(({ address }) => address));
        respond({ statusCode: status, destroy() {} });
      });
    };
    return req;
  });
  syncBuiltinESMExports();
  try {
    assert.equal((await webhookFetch("https://receiver.example/events")).status, 204);
    assert.deepEqual(connected, answers);
    assert.equal(lookups, 1, "no second, unchecked DNS resolution");
    status = 302;
    await assert.rejects(
      webhookFetch("https://receiver.example/events"),
      refusal(REDIRECT_REFUSED),
    );
    assert.equal(lookups, 2, "redirect did not initiate another request");
    answers = ["127.0.0.1"];
    await assert.rejects(webhookFetch("https://receiver.example/events"), refusal(RECEIVER_RULE));
    assert.equal(connected.length, 4, "private answer never reaches the connector");
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
