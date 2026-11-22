import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { testChangesReport, testLinesSince, testWeakeningSince } from "./verification-evidence.mjs";

if (process.argv.includes("--help")) {
  console.log(`Usage: npm run test-changes
Reports lines changed in the test directories since origin/main, uncommitted and new files included,
and flags added skip/only/todo and net-removed assertion lines. Reads Git only; runs no tests.
Exits 1 when Git cannot compare against origin/main, so a shallow checkout fails visibly.
In GitHub Actions it also writes the report to the job summary.`);
} else {
  const cwd = resolve(import.meta.dirname, "..");
  const lines = testLinesSince(cwd);
  const weakening = testWeakeningSince(cwd);
  const report = testChangesReport(lines, weakening);
  for (const line of report) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Test changes\n\n\`\`\`\n${report.join("\n")}\n\`\`\`\n`,
    );
  if (lines.unavailable || weakening.unavailable) process.exitCode = 1;
}
