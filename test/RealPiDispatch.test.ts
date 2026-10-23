/**
 * Session dispatch against the real installed Pi: a parent Pi, launched by a scratch Piano, uses
 * Piano's bundled extension to start a child session from a self-contained brief and to read the
 * child's answer back. Only the model is a local script; there are no credentials, no model credits
 * and no external traffic.
 *
 * This is the boundary where the claim actually lives. The fake-protocol tests prove Piano's
 * message handling and the adapter's attribution, but only a real Pi can show that a
 * Piano-launched session is declared the dispatch tools at all, that a handle written into the
 * tool's visible text survives Pi's tool history well enough to address the child, and that the
 * child is a second Piano-owned session rather than a process some extension spawned itself.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { sessionExtension } from "../server/PiCli.ts";
import { startRealPiDispatch } from "./fixtures/RealPiDispatch.ts";

test("a real Pi dispatches a brief and reads the child's answer back", {
  timeout: 180_000,
}, async () => {
  const fixture = await startRealPiDispatch();
  try {
    const database = new DatabaseSync(fixture.database, { readOnly: true });
    try {
      assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 9);
    } finally {
      database.close();
    }
    const client = await fixture.connect();
    const selectionId = randomUUID();
    client.send({
      _tag: "create_session",
      selectionId,
      cwd: fixture.parentRepo,
      options: { model: fixture.model },
      text: fixture.parentPrompt,
    });

    const selected = await client.next(
      (message) => message._tag === "selected" && message.selectionId === selectionId,
      "the parent session",
    );
    assert.equal(selected._tag, "selected");
    const parentSessionId = selected._tag === "selected" ? selected.sessionId : null;
    assert.ok(parentSessionId, "the parent session must be created and hosted");
    assert.equal(selected._tag === "selected" && selected.snapshot.state.thinkingLevel, "low");

    const reported = await client.next(
      (message) =>
        message._tag === "session" &&
        message.event._tag === "message_end" &&
        message.event.message.role === "assistant" &&
        message.event.message.text.includes("PARENT_REPORT"),
      "the parent's report of the child's answer",
    );
    const text =
      reported._tag === "session" && reported.event._tag === "message_end"
        ? reported.event.message.text
        : "";
    // The whole round trip: brief out through the start tool, answer back through the wait tool.
    assert.match(text, new RegExp(fixture.report.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const requests = fixture.requests();
    // The parent's own turns are ordered; when the child reaches the model between them is not,
    // because start returns on the brief's admission rather than on the child's answer.
    assert.deepEqual(
      requests.filter((request) => request.role === "parent").map((request) => request.answered),
      ["piano_start_session call", "piano_wait_sessions call", "report"],
      "the parent started a session, waited on the returned handle, and reported the answer",
    );
    assert.deepEqual(
      requests.filter((request) => request.role === "child").map((request) => request.answered),
      ["child-answer"],
      "exactly one child session answered the brief",
    );
    const parentTools = requests.find((request) => request.role === "parent")?.tools ?? [];
    assert.ok(
      parentTools.includes("piano_start_session") && parentTools.includes("piano_wait_sessions"),
      `a Piano-launched Pi is declared the dispatch tools; it was declared ${parentTools.join(", ") || "none"}`,
    );

    // A self-contained brief: the child is given the brief, never the parent's own conversation.
    const child = requests.find((request) => request.role === "child");
    assert.ok(child, "the brief reached a child session");
    assert.match(child.userText, new RegExp(fixture.brief.slice(0, 20)));
    assert.equal(
      child.sawParentSecret,
      false,
      "the child must not be shown the parent's conversation",
    );

    const handle = fixture.handle();
    assert.ok(handle, "the model read the handle out of the start tool's visible text");

    const childSelectionId = randomUUID();
    client.send({
      _tag: "select",
      selectionId: childSelectionId,
      cwd: handle.cwd as string,
      sessionId: handle.sessionId as string,
    });
    const childView = await client.next(
      (message) => message._tag === "selected" && message.selectionId === childSelectionId,
      "the child's requested thinking level",
    );
    assert.equal(
      childView._tag === "selected" && childView.snapshot.state.thinkingLevel,
      "high",
      "the tool's explicit effort overrides normal defaults in the real Pi session",
    );
    // The backlink lives in the child's own Pi history, written by Piano's extension.
    assert.equal(
      childView._tag === "selected" && childView.snapshot.state.dispatchedFrom,
      parentSessionId,
      "the child names the session that dispatched it",
    );
    assert.equal(
      selected._tag === "selected" && selected.snapshot.state.dispatchedFrom,
      undefined,
      "a session started by a person names no dispatcher",
    );

    // One owner: Piano starts every Pi, and each session has exactly one process.
    const sessions = fixture.spawns().filter((spawned) => spawned.sessionId !== null);
    const sessionIds = sessions.map((spawned) => spawned.sessionId);
    assert.deepEqual(
      [...new Set(sessionIds)].length,
      sessionIds.length,
      `one Pi process per session; saw ${sessionIds.join(", ")}`,
    );
    assert.ok(
      sessionIds.includes(parentSessionId) && sessionIds.includes(handle.sessionId as string),
      "the parent and the handle's child are both Piano-started sessions",
    );
    assert.deepEqual(
      [...new Set(fixture.spawns().map((spawned) => spawned.ppid))],
      [fixture.backend.pid],
      "every Pi is a child of the Piano server, never of another Pi or an extension",
    );
    for (const spawned of sessions) {
      assert.ok(
        spawned.extensions.includes(sessionExtension),
        `${spawned.sessionId} loaded Piano's session extension`,
      );
      assert.deepEqual(
        spawned.endpoint,
        { wsUrl: `ws://127.0.0.1:${fixture.backend.port}/ws`, origin: fixture.backend.origin },
        `${spawned.sessionId} was told how to reach this Piano`,
      );
    }

    // The child is an ordinary session a user can open, not a hidden worker.
    client.send({ _tag: "registry" });
    const registry = await client.next(
      (message) =>
        message._tag === "registry" &&
        (message.sessionReferences ?? []).some(
          (reference) => reference.sessionId === handle.sessionId,
        ),
      "the child in Piano's registry",
    );
    assert.equal(registry._tag, "registry");
  } finally {
    await fixture.close();
  }
});
