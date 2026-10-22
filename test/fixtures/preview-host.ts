// A fake supervisor host for preview contracts: systemd on Linux, launchd on macOS. The app's
// lifecycle is set in neutral terms and rendered in each supervisor's own output format.
// Listener ownership stays real: /proc on Linux, lsof and ps on macOS.
import { execFile, execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PreviewAdapter } from "../../scripts/PreviewAdapter.ts";

export type Platform = "linux" | "darwin";
export interface FakeHost {
  /** `gone` is a unit the supervisor no longer knows, as after a reboot. */
  phase: "failed" | "running" | "gone";
  /** Supervisor run count; a change means someone else restarted the unit. */
  runs: number;
  /** Whether the running unit's processes include this test process. */
  owner: "self" | "other";
  journal: string;
  unavailable: boolean;
  lostReply: boolean;
  /** Blocks every submission forever, after reporting it on stdout. */
  hangOnSubmit: boolean;
}

const failure = (text: string, status: number) => Object.assign(new Error(text), { status });

/** Runs a real host command, rejecting with its exit status like the adapter's own runner. */
function real(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(args[0], args.slice(1), (error, stdout) => {
      if (error) reject(failure(error.message, typeof error.code === "number" ? error.code : 1));
      else resolve(stdout);
    });
  });
}

async function selfGroup(platform: Platform) {
  return platform === "linux"
    ? (await readFile("/proc/self/cgroup", "utf8")).trim().split("::").at(-1)!
    : execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(process.pid)], {
        encoding: "utf8",
      }).trim();
}

/** `launched` holds each submission as text: systemd-run argv or the launchd plist. */
export function fakeAdapter(platform: Platform, stateRoot: string, host: FakeHost) {
  const launched: string[] = [];
  const stops: string[][] = [];
  const submitted = async (unitInArgs: (unit: string) => boolean) => {
    // Durable intent must precede even an uncertain external submission.
    const files = (await readdir(stateRoot)).filter((file) => file.endsWith(".json"));
    if (!files.length) throw new Error("submission before durable intent");
    const records = await Promise.all(
      files.map(async (file) => JSON.parse(await readFile(join(stateRoot, file), "utf8"))),
    );
    if (!records.some((record) => unitInArgs(record.unit)))
      throw new Error("submission names no saved unit");
    if (host.hangOnSubmit) {
      process.stdout.write("submitted\n");
      await new Promise(() => {});
    }
    if (host.lostReply) throw new Error("lost acknowledgement");
  };
  const systemd = async (args: string[]) => {
    if (host.unavailable) throw new Error("user manager unavailable");
    if (args[0] === "loginctl") return "yes";
    if (args.includes("--value")) return "/user.slice/manager";
    if (args[0] === "journalctl") return host.journal;
    if (args[0] === "systemd-run") {
      await submitted((unit) => args.includes(`--unit=${unit}`));
      launched.push(args.join("\n"));
      return "";
    }
    if (args.includes("stop")) stops.push(args);
    if (args.includes("show")) {
      const fields =
        host.phase === "gone"
          ? { LoadState: "not-found", ActiveState: "inactive", InvocationID: "" }
          : host.phase === "failed"
            ? { LoadState: "loaded", ActiveState: "failed", InvocationID: `run-${host.runs}` }
            : {
                LoadState: "loaded",
                ActiveState: "active",
                SubState: "running",
                InvocationID: `run-${host.runs}`,
                ControlGroup: host.owner === "self" ? await selfGroup(platform) : "/not-ours",
              };
      return Object.entries(fields)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
    }
    return "";
  };
  // launchd forgets a job as soon as it is booted out; a reboot or logout forgets them all.
  const loaded = new Set<string>();
  const launchd = async (args: string[]) => {
    if (args[0] === "/usr/sbin/lsof" || args[0] === "/bin/ps") return real(args);
    if (host.unavailable) throw new Error("launchd domain unavailable");
    const [, verb, target] = args;
    if (verb === "bootstrap") {
      const plist = args[3];
      await submitted((unit) => plist.endsWith(`/${unit}.plist`));
      launched.push(await readFile(plist, "utf8"));
      await writeFile(plist.replace(/\.plist$/, ".log"), host.journal);
      loaded.add(plist.slice(plist.lastIndexOf("/") + 1, -".plist".length));
      return "";
    }
    if (verb === "bootout") {
      stops.push(args);
      if (!loaded.delete(target.slice(target.lastIndexOf("/") + 1)))
        throw failure("Boot-out failed: 3: No such process", 3);
      return "";
    }
    if (verb === "print" && target.split("/").length === 2) return "domain";
    if (verb === "print") {
      if (host.phase === "gone" || !loaded.has(target.slice(target.lastIndexOf("/") + 1)))
        throw failure("Could not find service", 113);
      if (host.phase === "failed")
        return `\tstate = not running\n\truns = ${host.runs}\n\tlast exit code = 1\n`;
      const pid = host.owner === "self" ? await selfGroup(platform) : "999999";
      return `\tstate = running\n\truns = ${host.runs}\n\tpid = ${pid}\n\t\tstate = active\n`;
    }
    throw new Error(`unexpected launchctl call: ${args.join(" ")}`);
  };
  const adapter = new PreviewAdapter({
    platform,
    uid: 1000,
    callerGroup: async () => "/caller",
    // The fake job has no real processes, so a stopped job's process group is always gone.
    groupAlive: () => false,
    run: platform === "linux" ? systemd : launchd,
  });
  return { adapter, launched, stops };
}
