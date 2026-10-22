// A separate helper killed after durable intent and during uncertain supervisor submission.
import { fakeAdapter, type Platform } from "./preview-host.ts";

const [platform, workspace, stateRoot] = process.argv.slice(2) as [Platform, string, string];
const { adapter } = fakeAdapter(platform, stateRoot, {
  phase: "failed",
  runs: 1,
  owner: "other",
  journal: "",
  unavailable: false,
  lostReply: false,
  hangOnSubmit: true,
});
await adapter.request({ action: "start", workspace, command: ["/bin/false"] }, stateRoot, {
  origin: "https://test.exe.xyz",
});
