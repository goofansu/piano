import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const fixture = JSON.parse(readFileSync(process.env.PIANO_TEST_GH_FIXTURE, "utf8"));
const args = process.argv.slice(2),
  list = args[1] === "list";
const repo = args.includes("--repo") ? args[args.indexOf("--repo") + 1] : undefined;
if (fixture.log)
  appendFileSync(fixture.log, `${JSON.stringify({ GH_HOST: process.env.GH_HOST, args })}\n`);
if (list && !repo) {
  console.error("fake gh: pr list without --repo lists only the one base repository gh picks");
  process.exit(1);
}
const unresolved = repo?.split("/").slice(-2).join("/");
if (fixture.unresolvedRepos?.includes(unresolved)) {
  console.error(
    `GraphQL: Could not resolve to a Repository with the name '${unresolved}'. (repository)`,
  );
  process.exit(1);
}
if (
  (fixture.expectedHost && process.env.GH_HOST !== fixture.expectedHost) ||
  (fixture.expectedRepo && repo !== fixture.expectedRepo) ||
  (fixture.expectedRepos && !fixture.expectedRepos.includes(repo))
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
const fields = args[args.indexOf("--json") + 1].split(",");
if (fixture.checksError && fields.includes("statusCheckRollup")) {
  console.error(fixture.checksError);
  process.exit(1);
}
const baseRepo = (pr) => new URL(pr.url).pathname.split("/").slice(1, 3).join("/").toLowerCase();
const listedIn = (pr) => baseRepo(pr) === repo.split("/").slice(-2).join("/").toLowerCase();
const selected = (pr) =>
  Object.fromEntries(Object.entries(pr).filter(([key]) => fields.includes(key)));
if (list)
  console.log(
    JSON.stringify(
      fixture.prs
        .filter(
          (p) =>
            p.headRefName === args[args.indexOf("--head") + 1] && p.state === "OPEN" && listedIn(p),
        )
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
