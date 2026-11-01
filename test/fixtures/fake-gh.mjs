// Controlled external forge boundary for session PR module/browser checks; no credentials/network.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const fixture = JSON.parse(readFileSync(process.env.PIANO_TEST_GH_FIXTURE, "utf8"));
const args = process.argv.slice(2),
  list = args[1] === "list";
const repo = args.includes("--repo") ? args[args.indexOf("--repo") + 1] : undefined;
if (
  (fixture.expectedHost && process.env.GH_HOST !== fixture.expectedHost) ||
  (fixture.expectedRepo && repo !== fixture.expectedRepo)
) {
  console.error("Incorrect GitHub API routing");
  process.exit(1);
}
if (fixture.gate && args[1] === (fixture.gate.operation ?? "list")) {
  writeFileSync(fixture.gate.started, "started");
  for (let n = 0; !existsSync(fixture.gate.release); n++) {
    if (n > 500) process.exit(1);
    await delay(10);
  }
}
if (fixture.error) {
  console.error(fixture.error);
  process.exit(1);
}
if (fixture.malformed) {
  console.log("{}");
  process.exit(0);
}
// Like gh, return only requested fields so translation tests catch missing --json selections.
const fields = args[args.indexOf("--json") + 1].split(",");
// A token that may read pull requests but not their checks: GitHub refuses only that field.
if (fixture.checksError && fields.includes("statusCheckRollup")) {
  console.error(fixture.checksError);
  process.exit(1);
}
const selected = (pr) =>
  Object.fromEntries(Object.entries(pr).filter(([key]) => fields.includes(key)));
if (list)
  console.log(
    JSON.stringify(
      fixture.prs
        .filter((p) => p.headRefName === args[args.indexOf("--head") + 1] && p.state === "OPEN")
        .map(selected),
    ),
  );
else {
  const url = repo
    ? `https://github.com/${repo.split("/").slice(-2).join("/")}/pull/${args[2]}`
    : args[2];
  const pr = fixture.prs.find(
    (p) => p.url.toLowerCase().replace("github.int.exe.xyz", "github.com") === url.toLowerCase(),
  );
  if (!pr) {
    console.error("not found");
    process.exit(1);
  }
  console.log(JSON.stringify(selected(pr)));
}
