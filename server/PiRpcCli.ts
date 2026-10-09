/**
 * Bootstrap the locked Pi CLI with a completed catalog refresh. Pi 1.1.0's RPC
 * startup refresh is background-only and get_available_models reads a snapshot,
 * so short-lived probes otherwise miss newly configured gateways (INV-12).
 * Pi still owns credentials, persisted model metadata and all CLI resources.
 */
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

if (!process.argv.includes("--offline") && process.env.PI_OFFLINE === undefined) {
  await ModelRuntime.create({ allowModelNetwork: true, modelRefreshTimeoutMs: 15_000 });
  // The catalog is ready. Do not launch a second background refresh that a
  // short-lived probe can interrupt while Pi holds its model-store file lock.
  process.argv.push("--offline");
}

await import("../node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
