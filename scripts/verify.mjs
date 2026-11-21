import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  captureRevision,
  executionEnvironment,
  revisionOutcome,
  saveRun,
  testLinesSince,
} from "./verification-evidence.mjs";

const cwd = resolve(import.meta.dirname, "..");
if (process.argv.includes("--help")) {
  console.log(`Usage: npm run verify -- [evidence-directory]
Runs npm run typecheck, npm run lint, npm test. No browser or model calls.
Reports lines changed under test/ since origin/main, uncommitted and new files included.
Fresh checkout: npm ci (see docs/development.md).
Focused: node --test --import ./test/setup.ts test/<path>.test.ts
Browser: npm run test:browser (or node test/browser/<journey>.mjs <evidence-directory>)
Policy, prerequisites and manual scratch checks: docs/testing.md, .agents/skills/verify-piano/SKILL.md
Evidence defaults to .scratch/verify/<timestamp>-<pid>; a pass covers only this baseline.`);
} else {
  const evidence = resolve(
    process.argv[2] ?? join(cwd, ".scratch/verify", `${Date.now()}-${process.pid}`),
  );
  mkdirSync(evidence, { recursive: true });
  const commands = [
    ["npm", "run", "typecheck"],
    ["npm", "run", "lint"],
    ["npm", "test"],
  ];
  const record = {
    name: "baseline",
    cwd,
    command: [process.execPath, ...process.execArgv, ...process.argv.slice(1)],
    startedAt: new Date().toISOString(),
    outcome: "running",
    checks: commands.map((command, i) => ({
      command,
      outcome: "not-run",
      log: join(evidence, `${i + 1}-${command.at(-1)}.log`),
    })),
  };
  saveRun(evidence, record);
  let active;
  let signal;
  let killTimer;
  const interrupt = (received) => {
    if (signal) return;
    signal = received;
    record.signal = received;
    record.phase = "cancelling";
    saveRun(evidence, record);
    if (active?.pid) {
      try {
        process.kill(-active.pid, "SIGTERM");
      } catch {}
      killTimer = setTimeout(() => {
        try {
          process.kill(-active.pid, "SIGKILL");
        } catch {}
      }, 5000);
    }
  };
  const onInt = () => interrupt("SIGINT");
  const onTerm = () => interrupt("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  try {
    record.revision = captureRevision(cwd);
    record.environment = executionEnvironment(cwd);
    const missing = [
      ...(!["linux", "darwin"].includes(process.platform)
        ? ["platform: this wrapper supports Linux/macOS"]
        : []),
      ...(!existsSync(join(cwd, "node_modules")) ? ["dependencies: npm ci"] : []),
      ...Object.entries(record.environment.tools)
        .filter(([, version]) => typeof version !== "string")
        .map(([tool]) => `${tool}: see docs/development.md#setup`),
    ];
    if (missing.length) {
      record.outcome = "blocked";
      record.reason = `Missing prerequisites: ${missing.join("; ")}`;
    } else {
      for (const check of record.checks) {
        if (signal) break;
        check.startedAt = new Date().toISOString();
        check.outcome = "running";
        saveRun(evidence, record);
        console.log(`\n$ ${check.command.join(" ")}\nLog: ${check.log}`);
        const fd = openSync(check.log, "w");
        try {
          const result = await new Promise((done) => {
            active = spawn(check.command[0], check.command.slice(1), {
              cwd,
              detached: true,
              stdio: ["ignore", "pipe", "pipe"],
            });
            const output = (data) => {
              writeSync(fd, data);
              process.stdout.write(data);
            };
            active.stdout.on("data", output);
            active.stderr.on("data", output);
            active.on("error", (error) => done({ error: String(error) }));
            active.on("close", (code, signal) => done({ code, signal }));
          });
          Object.assign(check, result);
          check.outcome = signal
            ? "cancelled"
            : result.error
              ? "error"
              : result.code === 0
                ? "passed"
                : "failed";
        } finally {
          closeSync(fd);
          check.finishedAt = new Date().toISOString();
          saveRun(evidence, record);
        }
      }
      if (!signal)
        record.outcome = record.checks.every((check) => check.outcome === "passed")
          ? "passed"
          : "failed";
    }
  } catch (error) {
    record.outcome = signal ? "cancelled" : "error";
    record.error = String(error.stack ?? error);
  } finally {
    if (killTimer) {
      clearTimeout(killTimer);
      try {
        process.kill(-active.pid, "SIGKILL");
      } catch {}
    }
    record.revisionAfter = captureRevision(cwd);
    record.contentObservation = revisionOutcome(
      record.revision ?? { identity: null },
      record.revisionAfter,
    );
    if (record.outcome === "passed" && record.contentObservation !== "endpoints-match")
      record.outcome = record.contentObservation;
    if (signal) record.outcome = "cancelled";
    record.testLines = testLinesSince(cwd);
    record.finishedAt = new Date().toISOString();
    record.exitCode =
      record.outcome === "passed" ? 0 : signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1;
    saveRun(evidence, record);
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
  }
  for (const check of record.checks)
    console.log(`${check.outcome.toUpperCase()}: ${check.command.join(" ")} — ${check.log}`);
  console.log(
    `${record.outcome.toUpperCase()}: baseline${record.reason ? ` — ${record.reason}` : ""}. Evidence: ${evidence}/run.json`,
  );
  const lines = record.testLines;
  console.log(
    lines.unavailable
      ? `Test lines since ${lines.base}: unavailable — ${lines.unavailable}`
      : `Test lines since ${lines.base}: +${lines.added} −${lines.removed} in ${lines.files} file(s) under test/.`,
  );
  console.log(
    "Pass means command exit 0; skipped subtests are not coverage (see logs). Browser journeys and acceptance claims are not evaluated here.",
  );
  process.exitCode = record.exitCode;
}
