/**
 * ADR 0004: a Piano serving another machine's gateway at /ws/peer decides that connection's
 * scope itself and answers refusals with ordinary replies, without ending the connection.
 * Driven against a real backend (fake Pi) whose registry lists one session.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { WebSocket } from "@effect/platform-node/NodeWS";
import { IMAGE_UPLOAD_PATH, IMAGE_PREVIEW_PATH } from "../shared/remoteImages.ts";
import { imageUploadBody } from "../web/src/lib/remoteImages.ts";
import { gatewayFixture, identity } from "./fixtures/peer-gateway.ts";
import { readRegistry } from "./fixtures/registry.ts";

type Frame = { _tag: string; [key: string]: unknown };

async function attach(base: string, path: "/ws" | "/ws/peer") {
  const ws = new WebSocket(`${base.replace("http", "ws")}${path}`, { headers: { Origin: base } });
  const frames: Frame[] = [];
  const events = new EventTarget();
  ws.on("message", (raw) => {
    const frame = JSON.parse(String(raw));
    frames.push(frame);
    ws.send(JSON.stringify({ _tag: "ack", deliveryId: frame.deliveryId }));
    events.dispatchEvent(new Event("frame"));
  });
  await once(ws, "open");
  let nonce = 0;
  const next = (test: (frame: Frame) => boolean, from = 0) =>
    new Promise<Frame>((resolve, reject) => {
      const found = () => frames.slice(from).find(test);
      const check = () => {
        const frame = found();
        if (!frame) return;
        clearTimeout(timer);
        events.removeEventListener("frame", check);
        resolve(frame);
      };
      const timer = setTimeout(() => {
        events.removeEventListener("frame", check);
        reject(new Error(`no matching frame; saw ${frames.map((f) => f._tag).join(",")}`));
      }, 10_000);
      events.addEventListener("frame", check);
      check();
    });
  /** Frames the server sent in answer to `message`, up to a ping that follows it. */
  const answers = async (message: object) => {
    const from = frames.length;
    const marker = `after-${++nonce}`;
    ws.send(JSON.stringify(message));
    ws.send(JSON.stringify({ _tag: "ping", nonce: marker }));
    await next((frame) => frame._tag === "pong" && frame.nonce === marker, from);
    return frames
      .slice(from)
      .filter(
        (frame) => !["pong", "hosts", "registry", "catalogs_invalidated"].includes(frame._tag),
      );
  };
  await next((frame) => frame._tag === "registry");
  return { ws, frames, next, answers };
}

test(
  "prepared remote images are validated before creation, consumed once, and projected with session provenance",
  { timeout: 30_000 },
  async (t) => {
    const f = await gatewayFixture(t, { checkout: true });
    const peer = await attach(f.base, "/ws/peer");
    t.after(() => peer.ws.terminate());
    const png = {
      kind: "image" as const,
      name: "test.png",
      mimeType: "image/png" as const,
      data: "iVBORw0KGgo=",
    };
    const target = { cwd: f.checkout };
    const upload = (image = png, destination = target) =>
      fetch(f.base + IMAGE_UPLOAD_PATH, {
        method: "POST",
        headers: { Origin: f.base },
        body: imageUploadBody(destination, [image]),
      });
    const before = await readRegistry("unused", f.database);
    assert.equal((await upload({ ...png, data: "YQ==" })).status, 400);
    assert.equal((await upload(png, { cwd: "/unregistered" })).status, 404);
    assert.equal(
      (
        await fetch(f.base + IMAGE_UPLOAD_PATH, {
          method: "POST",
          body: imageUploadBody(target, [png]),
        })
      ).status,
      403,
    );
    const response = await upload();
    assert.equal(response.status, 200);
    const preparedImages = await response.json();
    const create = {
      _tag: "create_session",
      selectionId: "images-new",
      attemptId: "images-attempt",
      cwd: f.checkout,
      options: {},
      text: "",
      preparedImages,
    };
    for (const invalid of [
      { ...create, selectionId: "mixed", attachments: [png] },
      { ...create, selectionId: "absent", preparedImages: { id: "missing" } },
    ])
      assert.equal((await peer.answers(invalid))[0]?._tag, "selection_rejected");
    assert.deepEqual(
      (await readRegistry("unused", f.database)).sessions,
      before.sessions,
      "invalid preparation starts no work",
    );
    peer.ws.send(JSON.stringify(create));
    const selected = await peer.next(
      (m) => m._tag === "selected" && m.selectionId === "images-new",
    );
    assert.equal(selected.cwd, f.checkout);
    const sessionId = String(selected.sessionId);
    const imageMessage = await peer.next(
      (m) =>
        m._tag === "session" &&
        (m.event as { _tag: string; message?: { role: string; attachments?: unknown[] } }).message
          ?.role === "user",
    );
    const attachments = (imageMessage.event as { message: { attachments: { url: string }[] } })
      .message.attachments;
    assert.equal(attachments.length, 1);
    const hash = attachments[0].url.split("/").at(-1)!;
    const listing = await readRegistry("unused", f.database);
    const workspaceId = listing.workspaces.find((w) => w.path === f.checkout)!.id;
    const path =
      f.base + IMAGE_PREVIEW_PATH + "?" + new URLSearchParams({ workspaceId, sessionId, hash });
    const preview = await fetch(path);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("content-type"), "image/png");
    assert.equal(preview.headers.get("cache-control"), "private, no-store");
    assert.equal(preview.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), Buffer.from(png.data, "base64"));
    assert.equal((await fetch(path + "&extra=1")).status, 400);
    assert.equal((await fetch(path, { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
    const unrelated =
      f.base +
      IMAGE_PREVIEW_PATH +
      "?" +
      new URLSearchParams({
        workspaceId: identity.workspaceId,
        sessionId: identity.sessionId,
        hash,
      });
    assert.equal(
      (await fetch(unrelated)).status,
      404,
      "a registered session cannot read another session's cached hash",
    );
    assert.equal(
      (await peer.answers({ ...create, selectionId: "duplicate" })).find(
        (m) => m.selectionId === "duplicate",
      )?._tag,
      "error", // Expired capability cannot claim the original attempt was never sent.
    );
    assert.equal(
      (await readRegistry("unused", f.database)).sessions.length,
      listing.sessions.length,
    );
    assert.ok(
      !(
        await peer.answers({ _tag: "act", selectionId: "images-new", action: { _tag: "stop" } })
      ).some((m) => m._tag === "error"),
      "a refused preparation cannot steal the current selection",
    );
    // Re-select the created session: a small reference on act is resolved only for that selection.
    peer.ws.send(
      JSON.stringify({
        _tag: "select",
        cwd: f.checkout,
        sessionId: null,
        selectionId: "continue",
        attemptId: "images-attempt",
      }),
    );
    const reconciled = await peer.next(
      (m) => m._tag === "selected" && m.selectionId === "continue",
    );
    assert.equal(
      reconciled.sessionId,
      sessionId,
      "read-only attempt reconciliation preserves the original session",
    );
    const nextUpload = await fetch(f.base + IMAGE_UPLOAD_PATH, {
      method: "POST",
      headers: { Origin: f.base },
      body: imageUploadBody({ cwd: f.checkout, sessionId }, [png]),
    });
    assert.equal(nextUpload.status, 200);
    const nextReference = await nextUpload.json();
    const act = {
      _tag: "act",
      selectionId: "continue",
      start: {},
      preparedImages: nextReference,
      action: { _tag: "prompt", text: "text and image", inputId: "image-follow-up" },
    };
    assert.equal(
      (await peer.answers({ ...act, selectionId: "wrong" })).find((m) => m.selectionId === "wrong")
        ?.inputId,
      "image-follow-up",
    );
    const from = peer.frames.length;
    peer.ws.send(JSON.stringify(act));
    await peer.next(
      (m) =>
        m._tag === "session" &&
        (m.event as { message?: { text: string } }).message?.text === "text and image",
      from,
    );
    const duplicate = await peer.answers(act);
    assert.ok(duplicate.some((m) => m._tag === "error" && m.inputId === "image-follow-up"));
  },
);

test(
  "ADR 0004: /ws/peer admits only the remote slice and answers refusals in sequence",
  {
    timeout: 60_000,
  },
  async (t) => {
    const f = await gatewayFixture(t, { checkout: true });
    const peer = await attach(f.base, "/ws/peer");
    const local = await attach(f.base, "/ws");
    t.after(() => {
      peer.ws.terminate();
      local.ws.terminate();
    });
    const notAvailable = /not available from another machine/i;

    await t.test("a session the registry does not list is rejected, not opened", async () => {
      for (const select of [
        { _tag: "select", selectionId: "unlisted", cwd: identity.cwd, sessionId: "terminal-only" },
        {
          _tag: "select",
          selectionId: "elsewhere",
          cwd: "/different",
          sessionId: identity.sessionId,
        },
      ]) {
        const [answer, ...rest] = await peer.answers(select);
        assert.equal(answer?._tag, "selection_rejected", JSON.stringify(select));
        assert.equal(answer?.selectionId, select.selectionId);
        assert.match(String(answer?.message), notAvailable);
        assert.deepEqual(rest, []);
      }
    });

    await t.test(
      "creation that would add more than a text session in a registered directory is refused",
      async () => {
        const base = { _tag: "create_session", cwd: f.checkout, options: {}, text: "hi" };
        const image = { kind: "image", name: "a.png", mimeType: "image/png", data: "iVBORw0KGgo=" };
        for (const [selectionId, create] of Object.entries({
          unregistered: { ...base, cwd: "/different" },
          worktree: { ...base, worktree: { branch: "feature" } },
          inherited: { ...base, inheritProject: true },
          named: { ...base, options: { name: "Named" } },
          dispatched: { ...base, options: { dispatchedFrom: identity.sessionId } },
          attached: { ...base, attachments: [image] },
        })) {
          const [answer, ...rest] = await peer.answers({ ...create, selectionId });
          assert.equal(answer?._tag, "selection_rejected", selectionId);
          assert.equal(answer?.selectionId, selectionId);
          assert.match(String(answer?.message), notAvailable, selectionId);
          assert.deepEqual(rest, [], selectionId);
        }
      },
    );

    await t.test("settings and unselected actions are refused with their replies", async () => {
      // Trusting a directory this machine never registered would run that directory's extensions.
      const [trust] = await peer.answers({ _tag: "set_trust", path: "/different", trusted: true });
      assert.equal(trust?._tag, "trust_failed");
      assert.equal(trust?.cwd, "/different");
      assert.match(String(trust?.message), notAvailable);

      const [act] = await peer.answers({
        _tag: "act",
        selectionId: "never-selected",
        action: { _tag: "prompt", text: "must not run", inputId: "input-1" },
      });
      assert.equal(act?._tag, "error");
      assert.equal(act?.inputId, "input-1", "the browser learns the input was never delivered");
      assert.match(String(act?.message), notAvailable);
    });

    await t.test("a registered folder's trust is decided from another machine", async () => {
      const from = peer.frames.length;
      peer.ws.send(JSON.stringify({ _tag: "set_trust", path: f.checkout, trusted: true }));
      const answer = await peer.next(
        (frame) =>
          (frame._tag === "trust" || frame._tag === "trust_failed") && frame.cwd === f.checkout,
        from,
      );
      // Pi holds the decision; the reply is the one this machine's own browser gets.
      assert.equal(answer._tag, "trust", JSON.stringify(answer));
      assert.equal(answer.requested, true);
      await peer.next(
        (frame) => frame._tag === "models" && (frame.catalog as { cwd: string }).cwd === f.checkout,
        from,
      );
    });

    await t.test("the same requests reach their work on this machine's own /ws", async () => {
      let from = local.frames.length;
      local.ws.send(JSON.stringify({ _tag: "set_trust", path: "/different", trusted: true }));
      const trust = await local.next(
        (frame) =>
          (frame._tag === "trust" || frame._tag === "trust_failed") && frame.cwd === "/different",
        from,
      );
      assert.doesNotMatch(String(trust.message ?? ""), notAvailable);
      from = local.frames.length;
      local.ws.send(
        JSON.stringify({
          _tag: "select",
          selectionId: "local-unlisted",
          cwd: "/different",
          sessionId: identity.sessionId,
        }),
      );
      const selection = await local.next(
        (frame) =>
          String(frame._tag).startsWith("selection") && frame.selectionId === "local-unlisted",
        from,
      );
      assert.doesNotMatch(String(selection.message ?? ""), notAvailable);
    });

    await t.test("reads about a folder no longer registered are skipped quietly", async () => {
      const from = peer.frames.length;
      peer.ws.send(JSON.stringify({ _tag: "models", cwd: "/different" }));
      peer.ws.send(JSON.stringify({ _tag: "trust", cwd: "/different" }));
      peer.ws.send(JSON.stringify({ _tag: "trust", cwd: identity.cwd }));
      // Requests run in arrival order of admission; the registered read's answer shows the others had their turn.
      await peer.next((frame) => frame._tag === "trust" && frame.cwd === identity.cwd, from);
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.deepEqual(
        peer.frames
          .slice(from)
          .filter((frame) => frame.cwd === "/different" || frame._tag === "error"),
        [],
      );
    });

    await t.test("a requested read about an unregistered folder is answered", async () => {
      const from = peer.frames.length;
      peer.ws.send(
        JSON.stringify({ _tag: "models", cwd: "/different", refresh: true, requestId: "r1" }),
      );
      const failed = await peer.next(
        (frame) => frame._tag === "models_failed" && frame.requestId === "r1",
        from,
      );
      assert.equal(failed.cwd, "/different");
      assert.match(String(failed.message), notAvailable);
    });

    await t.test("the peer folder-commands read answers only for registered folders", async () => {
      const read = (path: string, cwd: string) =>
        fetch(`${f.base}${path}`, {
          method: "POST",
          headers: { Origin: f.base, "content-type": "application/json" },
          body: JSON.stringify({ cwd }),
        });
      const notRegistered = /not a registered folder/i;
      // The fixture's registered folder is not on disk: reaching discovery shows as its own error.
      const listed = await read("/api/peer/commands", identity.cwd);
      assert.doesNotMatch((await listed.json()).error ?? "", notRegistered);
      const unlisted = await read("/api/peer/commands", "/different");
      assert.equal(unlisted.status, 409);
      assert.match((await unlisted.json()).error, notRegistered);
      // This machine's own browser read is not limited to registered folders.
      const own = await read("/api/commands", "/different");
      assert.doesNotMatch((await own.json()).error ?? "", notRegistered);
    });

    // Last but one: the started session keeps streaming frames the subtests above would read.
    await t.test(
      "a text session starts in a registered folder, and its selection takes actions",
      async () => {
        const from = peer.frames.length;
        peer.ws.send(
          JSON.stringify({
            _tag: "create_session",
            selectionId: "created",
            cwd: f.checkout,
            options: {},
            text: "Reply with exactly: X",
          }),
        );
        const selected = await peer.next(
          (frame) =>
            (frame._tag === "selected" || frame._tag === "selection_rejected") &&
            frame.selectionId === "created",
          from,
        );
        assert.equal(selected._tag, "selected", JSON.stringify(selected));
        assert.equal(selected.cwd, f.checkout);
        const sessionId = String(selected.sessionId);
        // The remote registers the session it started, so the main Piano lists it.
        await peer.next(
          (frame) =>
            frame._tag === "registry" &&
            (frame.sessionReferences as { sessionId: string }[]).some(
              (entry) => entry.sessionId === sessionId,
            ),
          from,
        );
        const answers = await peer.answers({
          _tag: "act",
          selectionId: "created",
          action: { _tag: "stop" },
        });
        assert.deepEqual(
          answers.filter((frame) => notAvailable.test(String(frame.message ?? ""))),
          [],
          "the created selection is not refused",
        );
      },
    );

    await t.test("this machine's projects are managed from another machine", async () => {
      type Listing = {
        projects: { id: string; name: string; instructions?: string; doneAt?: string }[];
        sessionReferences: { sessionId: string; projectId?: string }[];
      };
      const listed = { cwd: identity.cwd, sessionId: identity.sessionId };
      /** Send a change, then the toast that confirms it and the sidebar that shows it. */
      const change = async (message: object, shown: (listing: Listing) => boolean) => {
        const from = peer.frames.length;
        peer.ws.send(JSON.stringify(message));
        const answer = await peer.next(
          (frame) => frame._tag === "toast" || frame._tag === "error",
          from,
        );
        await peer.next(
          (frame) => frame._tag === "registry" && shown(frame as unknown as Listing),
          from,
        );
        return String(answer.message);
      };
      const project = (listing: Listing) => listing.projects.find((p) => p.id === "p-peer");
      const member = (listing: Listing, sessionId: string) =>
        listing.sessionReferences.find((s) => s.sessionId === sessionId)?.projectId;

      assert.equal(
        await change(
          {
            _tag: "save_project",
            project: { id: "p-peer", name: "Peer project", instructions: "Be brief." },
            assign: listed,
          },
          (listing) =>
            project(listing)?.instructions === "Be brief." &&
            member(listing, identity.sessionId) === "p-peer",
        ),
        "Project created",
      );
      assert.equal(
        await change(
          { _tag: "update_project", id: "p-peer", name: "Renamed" },
          (listing) => project(listing)?.name === "Renamed",
        ),
        "Project saved",
      );
      assert.equal(
        await change(
          { _tag: "assign_project", ...listed, projectId: null },
          (listing) => member(listing, identity.sessionId) === undefined,
        ),
        "Session removed from project",
      );
      assert.equal(
        await change(
          { _tag: "assign_project", ...listed, projectId: "p-peer" },
          (listing) => member(listing, identity.sessionId) === "p-peer",
        ),
        "Session moved to Renamed",
      );
      assert.equal(
        await change(
          { _tag: "set_project_done", id: "p-peer", done: true },
          (listing) => project(listing)?.doneAt !== undefined,
        ),
        "Project marked done",
      );

      // A new session joins the project it names, as one started on this machine does.
      const from = peer.frames.length;
      peer.ws.send(
        JSON.stringify({
          _tag: "create_session",
          selectionId: "in-project",
          cwd: f.checkout,
          projectId: "p-peer",
          options: {},
          text: "Reply with exactly: X",
        }),
      );
      const selected = await peer.next(
        (frame) =>
          (frame._tag === "selected" || frame._tag === "selection_rejected") &&
          frame.selectionId === "in-project",
        from,
      );
      assert.equal(selected._tag, "selected", JSON.stringify(selected));
      await peer.next(
        (frame) =>
          frame._tag === "registry" &&
          member(frame as unknown as Listing, String(selected.sessionId)) === "p-peer",
        from,
      );

      // Membership changes only for a session listed here; nothing is created on the way.
      for (const refused of [
        { _tag: "assign_project", cwd: "/different", sessionId: "s", projectId: "p-peer" },
        {
          _tag: "save_project",
          project: { id: "p-unlisted", name: "Unlisted" },
          assign: { cwd: "/different", sessionId: "s" },
        },
      ]) {
        // The session created above may still be reporting; only this request's replies count.
        const answers = (await peer.answers(refused)).filter(
          (frame) => frame._tag === "error" || frame._tag === "toast",
        );
        assert.equal(answers.length, 1, JSON.stringify(refused));
        assert.equal(answers[0]?._tag, "error", JSON.stringify(refused));
        assert.match(String(answers[0]?.message), notAvailable);
      }

      assert.equal(
        await change(
          { _tag: "delete_project", id: "p-peer" },
          (listing) =>
            listing.projects.length === 0 && member(listing, identity.sessionId) === undefined,
        ),
        "Project deleted",
      );
    });

    await t.test(
      "a listed session is renamed, pinned, archived and deleted from another machine",
      async () => {
        type Entry = { sessionId: string; title?: string; pinned?: boolean; archived: boolean };
        const entries = (frame: Frame) => frame.sessionReferences as Entry[];
        /** Send a change and wait for the sidebar that shows it; the toast that confirms it, if any. */
        const change = async (message: object, shown: (entries: Entry[]) => boolean) => {
          const from = peer.frames.length;
          peer.ws.send(JSON.stringify(message));
          await peer.next((frame) => frame._tag === "registry" && shown(entries(frame)), from);
          return peer.frames
            .slice(from)
            .filter((frame) => frame._tag === "toast" || frame._tag === "error")
            .map((frame) => String(frame.message));
        };
        const confirmed = async (
          message: object,
          toast: string,
          shown: (entries: Entry[]) => boolean,
        ) => {
          const from = peer.frames.length;
          await change(message, shown);
          const answer = await peer.next(
            (frame) => frame._tag === "toast" || frame._tag === "error",
            from,
          );
          assert.equal(answer.message, toast);
        };

        // Rename and Delete act on a session whose checkout exists: Pi starts there for the name.
        const from = peer.frames.length;
        peer.ws.send(
          JSON.stringify({
            _tag: "create_session",
            selectionId: "managed",
            cwd: f.checkout,
            options: {},
            text: "Reply with exactly: X",
          }),
        );
        const selected = await peer.next(
          (frame) =>
            (frame._tag === "selected" || frame._tag === "selection_rejected") &&
            frame.selectionId === "managed",
          from,
        );
        assert.equal(selected._tag, "selected", JSON.stringify(selected));
        const managed = { cwd: f.checkout, sessionId: String(selected.sessionId) };
        const find = (list: Entry[], sessionId: string) =>
          list.find((entry) => entry.sessionId === sessionId);
        await peer.next(
          (frame) => frame._tag === "registry" && !!find(entries(frame), managed.sessionId),
          from,
        );

        await confirmed(
          { _tag: "rename_session", ...managed, title: "Named from main" },
          "Session renamed",
          (list) => find(list, managed.sessionId)?.title === "Named from main",
        );
        const listed = { cwd: identity.cwd, sessionId: identity.sessionId };
        assert.deepEqual(
          await change(
            { _tag: "pin_session", ...listed, pinned: true },
            (list) => find(list, identity.sessionId)?.pinned === true,
          ),
          [],
          "pinning answers in the list alone",
        );
        await confirmed(
          { _tag: "delete_session", ...managed },
          "Session deleted",
          (list) => !find(list, managed.sessionId),
        );
        await confirmed(
          { _tag: "archive_session", ...listed },
          "Session archived",
          (list) => find(list, identity.sessionId)?.archived === true,
        );

        // Only a session listed here: nothing else on this machine is named, started or removed.
        for (const _tag of ["rename_session", "pin_session", "archive_session", "delete_session"]) {
          const answers = (
            await peer.answers({
              _tag,
              cwd: "/different",
              sessionId: identity.sessionId,
              title: "x",
              pinned: true,
            })
          ).filter((frame) => frame._tag === "error" || frame._tag === "toast");
          assert.equal(answers.length, 1, _tag);
          assert.equal(answers[0]?._tag, "error", _tag);
          assert.match(String(answers[0]?.message), notAvailable, _tag);
        }
      },
    );

    // After the creation above: closing its folder here is what this subtest needs.
    await t.test("a folder closed here cannot be reopened by a peer's new session", async () => {
      const folderPaths = (frame: Frame) =>
        (frame.folders as { path: string }[]).map((folder) => folder.path);
      const closing = local.frames.length;
      local.ws.send(JSON.stringify({ _tag: "remove_folder", path: f.checkout }));
      await local.next(
        (frame) => frame._tag === "registry" && !folderPaths(frame).includes(f.checkout),
        closing,
      );

      const from = peer.frames.length;
      peer.ws.send(
        JSON.stringify({
          _tag: "create_session",
          selectionId: "closed",
          cwd: f.checkout,
          options: {},
          text: "Reply with exactly: X",
        }),
      );
      const answer = await peer.next(
        (frame) =>
          (frame._tag === "selected" || frame._tag === "selection_rejected") &&
          frame.selectionId === "closed",
        from,
      );
      assert.equal(answer._tag, "selection_rejected", JSON.stringify(answer));
      assert.match(String(answer.message), notAvailable);
      // The models read for an existing session in the closed folder is still answered.
      const [models] = await peer.answers({
        _tag: "models",
        cwd: f.checkout,
        requestId: "closed-models",
      });
      assert.notEqual(models?._tag, "models_failed", JSON.stringify(models));
      const latest = local.frames.findLast((frame) => frame._tag === "registry");
      assert.ok(latest && !folderPaths(latest).includes(f.checkout), "the folder stays closed");
    });

    await t.test("refusals never end the connection", () => {
      assert.equal(peer.ws.readyState, WebSocket.OPEN);
    });
  },
);
