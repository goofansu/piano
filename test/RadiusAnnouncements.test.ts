import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RADIUS_PROGRESS,
  type RadiusObservation,
  radiusAnnouncements,
} from "../web/src/lib/radiusAnnouncements.ts";

const ALL_SET = "All set. New Pi sessions can use Radius tools and web search.";
const INSTALLED = "Web search installed. Start a new session to use it.";
const UNINSTALLED = "Web search uninstalled for new sessions.";
const REFRESHED = "Radius setup refreshed.";

type Observed = Extract<RadiusObservation, { kind: "observed" }>;
const idle: Observed = { kind: "observed", installation: { status: "idle" } };
const running = (action: "install" | "uninstall"): Observed => ({
  kind: "observed",
  installation: { status: "running", action },
});
const success = (action: "install" | "uninstall"): Observed => ({
  kind: "observed",
  installation: { status: "success", action },
});
const settled = (configured: boolean): RadiusObservation => ({ kind: "settled", configured });

/** The toasts a page shows for a sequence of observations, from first opening. */
function toasts(...observations: RadiusObservation[]) {
  let progress = RADIUS_PROGRESS;
  const shown: string[] = [];
  for (const observation of observations) {
    const next = radiusAnnouncements(progress, observation);
    progress = next.progress;
    if (next.message) shown.push(next.message);
  }
  return shown;
}

test("opening a setup that is already complete announces nothing", () => {
  assert.deepEqual(toasts(idle, settled(true), idle, settled(true)), []);
  assert.deepEqual(
    toasts(success("install"), settled(true)),
    [],
    "an install finished before the page opened is not news",
  );
});

test("setup turning complete here is announced once", () => {
  assert.deepEqual(toasts(idle, settled(false), idle, settled(true), idle, settled(true)), [
    ALL_SET,
  ]);
});

test("a web-search change seen to finish is announced when the page settles", () => {
  assert.deepEqual(
    toasts(
      idle,
      settled(false),
      running("install"),
      running("install"),
      success("install"),
      settled(false),
      settled(false),
    ),
    [INSTALLED],
  );
  assert.deepEqual(
    toasts(idle, settled(true), running("uninstall"), success("uninstall"), settled(false)),
    [UNINSTALLED],
  );
});

test("completing setup outranks the install that completed it", () => {
  assert.deepEqual(
    toasts(
      idle,
      settled(false),
      running("install"),
      success("install"),
      settled(true),
      settled(true),
    ),
    [ALL_SET],
  );
});

test("a manual refresh is confirmed only when no web-search change is running or awaiting its own toast", () => {
  assert.deepEqual(toasts(idle, settled(true), { ...idle, manual: true }), [REFRESHED]);
  assert.deepEqual(toasts(running("install"), { ...running("install"), manual: true }), []);
  assert.deepEqual(
    toasts(
      idle,
      settled(false),
      running("install"),
      { ...success("install"), manual: true },
      settled(false),
    ),
    [INSTALLED],
  );
});
