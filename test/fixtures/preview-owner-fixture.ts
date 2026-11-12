import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import type { PreviewConfig, PreviewRequest } from "../../scripts/PreviewAdapter.ts";
import { ownerRequest } from "../../scripts/PreviewClient.ts";
import { PreviewOwner } from "../../scripts/PreviewOwner.ts";
import { type FakeHost, fakeAdapter, type Platform } from "./preview-host.ts";

/**
 * A preview owner over a fake supervisor for `platform`, in its own scratch checkout and state.
 * Shared by the PreviewOwner test files, which are split so Node runs them in parallel.
 */
export async function ownerFixture(t: TestContext, platform: Platform, lockWait?: number) {
  const root = await mkdtemp(join(tmpdir(), "preview-owner-test-"));
  const workspace = join(root, "checkout");
  const state = join(root, "state");
  await mkdir(workspace);
  const host: FakeHost = {
    phase: "failed",
    runs: 1,
    owner: "self",
    journal: "",
    unavailable: false,
    lostReply: false,
    hangOnSubmit: false,
  };
  const { adapter, launched, stops } = fakeAdapter(platform, state, host, lockWait);
  const config: PreviewConfig = { origin: "http://localhost" };
  const owners: PreviewOwner[] = [];
  const open = async (sessionId = "session", cwd = workspace) => {
    const owner = await PreviewOwner.open({ cwd, sessionId }, `generation-${owners.length}`, {
      adapter,
      root: state,
      config: async () => config,
    });
    owners.push(owner);
    return owner;
  };
  t.after(async () => {
    host.unavailable = false;
    host.phase = "failed";
    await Promise.allSettled(owners.map((owner) => owner.prepareRelease()));
    await rm(root, { recursive: true, force: true });
  });
  const owner = await open();
  const call = async (who = owner, changes: Partial<PreviewRequest> = {}) =>
    JSON.parse(
      await ownerRequest(who.identity.endpoint, {
        action: "start",
        command: [process.execPath, "-e", "process.exit(1)"],
        ...changes,
        workspace: "/untrusted-tool-workspace-is-ignored",
        owner: { sessionId: "forged", generation: "forged", workspace: "/" },
      }),
    );
  return { root, workspace, state, host, adapter, launched, stops, open, owner, call, config };
}

/** The status a loopback listener on `port` answers `/` with. */
export function statusAt(port: number) {
  return new Promise<number | undefined>((resolve, reject) => {
    get({ host: "127.0.0.1", port, path: "/" }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", reject);
  });
}
