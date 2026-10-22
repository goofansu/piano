// A separate helper killed after durable intent and during uncertain supervisor submission.
import { PreviewAdapter } from "../../scripts/PreviewAdapter.ts";

await new PreviewAdapter({
  platform: "linux",
  uid: 1000,
  callerGroup: async () => "/caller",
  run: async (args) => {
    if (args[0] === "loginctl") return "yes";
    if (args.includes("--value")) return "/user.slice/manager";
    if (args[0] === "systemd-run") {
      process.stdout.write("submitted\n");
      await new Promise(() => {});
    }
    return "";
  },
}).request(
  { action: "start", workspace: process.argv[2], command: ["/bin/false"] },
  process.argv[3],
  { origin: "https://test.exe.xyz" },
);
