import { enableCompileCache } from "node:module";

enableCompileCache();

if (!process.argv.includes("--offline") && process.env.PI_OFFLINE === undefined) {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  await ModelRuntime.create({ allowModelNetwork: true, modelRefreshTimeoutMs: 15_000 });
  process.argv.push("--offline");
}

await import("../node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
