import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const { captureRevision, revisionOutcome } = await import(
  new URL("../scripts/verification-evidence.mjs", import.meta.url).href
);

test("revision identifies dirty bytes, index, untracked inputs, deletion, modes, links and ignored config", () => {
  const root = mkdtempSync(join(tmpdir(), "piano-revision-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args]);
  const put = (name: string, bytes: string) => writeFileSync(join(root, name), bytes);
  try {
    git("init", "-q");
    put("source.ts", "one");
    put(".gitignore", ".env.local\nweb/dist/\n");
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base");
    let previous = captureRevision(root);
    const changed = (action: () => void) => {
      action();
      const next = captureRevision(root);
      assert.notEqual(next.identity, previous.identity);
      assert.equal(revisionOutcome(previous, next), "unstable");
      previous = next;
    };
    changed(() => put("source.ts", "dirty one"));
    changed(() => put("source.ts", "dirty two")); // Same dirty path, different bytes.
    changed(() => git("add", "source.ts"));
    changed(() => git("reset", "--", "source.ts"));
    changed(() => put("untracked.ts", "new input"));
    changed(() => rmSync(join(root, "source.ts")));
    changed(() => put("source.ts", "dirty two"));
    changed(() => chmodSync(join(root, "source.ts"), 0o755));
    changed(() => symlinkSync("source.ts", join(root, "link.ts")));
    changed(() => {
      rmSync(join(root, "link.ts"));
      symlinkSync("untracked.ts", join(root, "link.ts"));
    });
    changed(() => put(".env.local", "PRIVATE_SETTING=one"));
    changed(() => put(".env.local", "PRIVATE_SETTING=two"));
    assert.ok(
      !JSON.stringify(previous).includes("PRIVATE_SETTING"),
      "config values are hashed, not published",
    );
    assert.equal(revisionOutcome(previous, captureRevision(root)), "endpoints-match");
    assert.match(previous.scope.limitation, /cannot exclude transient edits/);
    mkdirSync(join(root, "web/dist"), { recursive: true });
    put("web/dist/index.html", "build one");
    const production = captureRevision(root, { production: true });
    put("web/dist/index.html", "build two");
    assert.notEqual(captureRevision(root, { production: true }).identity, production.identity);
    assert.equal(
      captureRevision(root).identity,
      previous.identity,
      "development scope excludes dist",
    );
    symlinkSync(tmpdir(), join(root, "external"));
    const external = captureRevision(root);
    assert.equal(revisionOutcome(external, external), "unknown");
    assert.match(external.problems.join("\n"), /outside captured paths/);
    rmSync(join(root, "external"));
    symlinkSync("not-here", join(root, "broken"));
    const broken = captureRevision(root);
    assert.equal(revisionOutcome(broken, broken), "unknown");
    assert.match(broken.problems.join("\n"), /Unresolved symlink/);
    rmSync(join(root, "broken"));
    git(
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${git("rev-parse", "HEAD").toString().trim()},submodule`,
    );
    mkdirSync(join(root, "submodule"));
    const submodule = captureRevision(root);
    assert.equal(revisionOutcome(submodule, submodule), "unknown");
    assert.match(submodule.problems.join("\n"), /including submodules/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
