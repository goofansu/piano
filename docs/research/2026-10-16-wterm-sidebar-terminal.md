# wterm as a sidebar terminal for Piano

Researched **2026-10-16** against Piano `3509b5ba5a5ced3300cc6226aaa1ac56ebe78601` and a wterm
checkout at `488e9a7344e812e35a951f803618d7767cc4be5b` (main, 2026-10-06; release tag `v0.5.4` is
`cc067a20a616fe62f0893ec94005943c349bb492`, 2026-09-28). It assesses a minimal terminal in the
right sidebar for running a few commands in the selected workspace. It is a recommendation, not
shipped functionality, and it does not amend [ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md),
which already classes a browser terminal as "an escape hatch", not the main UI.

## Conclusion

**wterm is not an embeddable terminal product; it is a client-side terminal emulator library with a
server-side PTY bridge that exists only as a Next.js example.** Its published packages (`@wterm/core`,
`@wterm/dom`, `@wterm/react`, 0.5.4, Apache-2.0) render a Zig-to-WASM VT emulator into the DOM, with
no runtime dependencies and a committed 27 KB `.wasm`; they are not xterm.js. Nothing server-side is
published: the WebSocket-to-PTY server, its flow control and reconnection protocol live in
`examples/local/` on Next.js 16, `ws` and `node-pty` 1.1.0. [W1–W3, W7–W9, N1]

So option A (embed wterm as-is) does not exist. The real choice is between **B**, `@wterm/dom` +
`@wterm/react` in the browser with a Piano-native Effect server module and a PTY dependency, and
**D**, a non-PTY command runner reusing `server/Subprocess.ts` with no new dependency. The deciding
cost is the PTY: Effect's `ChildProcess` only offers pipes, Piano's lockfile has no PTY library,
`node-pty` 1.1.0 ships prebuilt binaries for macOS and Windows but **none for Linux**, so on the
exe.dev VM it would run `node-gyp rebuild` and need a C++ toolchain; the fork `@lydell/node-pty`
ships Linux prebuilds but only as a beta. [L4, L8, L9, N1–N2]

**Recommendation:** do not adopt wterm's server code or its Next.js example. If an interactive shell
is wanted, take B with the two wterm client packages (small, dependency-free, Apache-2.0) and gate
it on a PTY package that installs without a compiler on both macOS and the exe.dev VM (G1). If the
need is truly "run a few commands and read the output", D covers it with zero new dependencies and
no new shell endpoint on the unauthenticated loopback server, at the cost of interactive programs
and TTY colors. Decide the UX first (G0); do not ship both.

## Evidence and inspection limits

- wterm cloned with `git clone --depth 50` into `~/.cache/checkouts/github.com/vercel-labs/wterm`
  and read as untrusted data. **No wterm build, install script, test or example was run.**
- Registry metadata from `npm view` and a `npm pack --dry-run` listing of `node-pty@1.1.0`; no
  package was installed into Piano or anywhere else.
- Piano read at the revision above; Effect source read from the installed `node_modules`.
- Bundle sizes below are npm **unpacked** sizes, not built or gzipped bundle sizes; measuring the
  real cost needs a build, which was out of scope. Browser behaviour, PTY compilation on the exe.dev
  VM and theme fidelity remain unverified (see §Not verified).

## 1. What wterm is

| Question | Finding | Source |
| --- | --- | --- |
| Kind | pnpm/turbo monorepo: `src/*.zig` VT core compiled to `packages/@wterm/core/wasm/wterm.wasm` (27,643 bytes, committed), client packages, a docs app, examples. No CLI, no server package. | W1, W2 |
| Published packages | `@wterm/core` (headless WASM bridge + `WebSocketTransport`), `@wterm/dom` (DOM renderer, input), `@wterm/react`, `@wterm/vue`, `@wterm/svelte`, `@wterm/ghostty` (libghostty WASM core, 591,867 bytes), `@wterm/just-bash`, `@wterm/markdown`. All 0.5.4, published 2026-09-29. | W1, W3–W6, N1 |
| License | Apache-2.0, root and every package. | W2, W3 |
| Status | Vercel Labs "experiment" badge; 0.5.1 to 0.5.4 released over September 2026; last commit a docs change on 2026-10-06. Single visible contributor in the changelog. | W1, W10 |
| Renderer | Own Zig core rendering rows as DOM spans (native selection, find, screen readers); **not xterm.js**, no canvas/WebGL addons. Alternative core: libghostty. | W1, W4 |
| Server PTY | `node-pty` 1.1.0 via `ws` 8 in `examples/local/server.ts` only. Not a package. | W7, W9 |
| Transport | `WebSocketTransport` in core is a bounded raw-bytes WebSocket client with reconnect. The local example does **not** use it: it has its own JSON control protocol plus binary output frames (§2). | W3, W8 |
| Runtime (consumer) | Browser packages have no runtime deps; `@wterm/react` peers `@wterm/dom` and `react-dom ^18 \|\| ^19`. Monorepo dev needs Node >= 24, pnpm >= 11, Zig 0.16 (WASM is committed and embedded, so consumers need no Zig). | W2, W3, W5 |
| Bun | Not required anywhere. | W2, W9 |

## 2. Architecture and wire protocol

**Client.** `WTerm(element, options)` loads the WASM (embedded base64 by default, or `wasmUrl`),
writes bytes with `write(string | Uint8Array)`, emits user input through `onData(string)` and X10
mouse bytes through `onBinary`, auto-fits with a `ResizeObserver` when `autoResize` is true, exposes
`fit()`, `readText()`, `setThemeColors()`, `onTitle`, `onBell`, `onWorkingDirectory` (OSC 7) and
`onShellIntegration` (OSC 133, Ghostty core only). `@wterm/react`'s `Terminal` is a `forwardRef`
component over it with a `TerminalHandle { write, resize, focus, instance }`. [W4, W5]

**`WebSocketTransport`** (core): `send(string | Uint8Array)`, `onData(Uint8Array | string)`,
`binaryType = "arraybuffer"`, reconnect with 1 s to 30 s backoff, outbound queue bounded to 1 MiB and
1,024 messages, 64 KiB/16 KiB water marks, `onBackpressure`. It carries no resize or session message;
bytes already handed to the socket are never replayed. It is a byte pipe, not a protocol. [W3]

**Local example protocol** (`examples/local/lib/terminal-protocol.ts`, `terminal-sessions.ts`,
`pty-output.ts`, `terminal-connection.ts`): [W7, W8]

| Direction | Message | Purpose |
| --- | --- | --- |
| client → server (JSON text) | `attach { session: token \| null, bytes }` | First message within 5 s; new session or resume with the byte offset the browser has parsed. |
| | `resize { cols, rows, width, height }` | Bounds 1–1024 × 1–512; the **first** resize spawns the shell. |
| | `input { id, data }` | Sequenced; `data` ≤ 64 KiB; duplicates never written twice. |
| | `ack { bytes }` | Credit: bytes the browser core has consumed, not bytes TCP received. |
| | `close` | Ends the shell. |
| server → client | `ready { session, resumed, input }` | 32-byte random hex token; last accepted input ID. |
| | binary frames | Raw PTY output, batched; window 128 KiB, low water 32 KiB, PTY `pause()`/`resume()` beyond it. |
| | `input-ack { input }`, `cwd { cwd }` | Delivery acknowledgement; working directory polled every 500 ms via `/proc/<pid>/cwd` or `lsof`. |

Lifecycle: detach keeps the shell for 30 s (`SESSION_GRACE_MS`), up to 32 sessions, bounded
replay on reattach, shell exit closes the socket with 1000. The shell is `$SHELL -l` (default
`/bin/zsh`), `cwd = $HOME`, `env = process.env` in full, `TERM=xterm-256color`; pixel size is set
with a `perl` ioctl because `node-pty.resize` zeroes it. [W7]

## 3. Weight

| Package | Version | Unpacked | Runtime deps | Native |
| --- | --- | --- | --- | --- |
| `@wterm/core` | 0.5.4 | 196 KB (incl. 27 KB wasm + ~37 KB base64 copy) | none | no |
| `@wterm/dom` | 0.5.4 | 545 KB | `@wterm/core` | no |
| `@wterm/react` | 0.5.4 | 41 KB | peers only | no |
| `@wterm/ghostty` (optional) | 0.5.4 | 735 KB (592 KB wasm) | `@wterm/core` | no |
| `node-pty` | 1.1.0 | 64 MB (prebuilds: darwin-arm64/x64, win32-arm64/x64; **no linux**) | `node-addon-api` | `install: node scripts/prebuild.js \|\| node-gyp rebuild` |
| `@lydell/node-pty` | 1.2.0-beta.15 (`latest` **is** the beta) | 14 KB + one optional ~107–168 KB platform package (linux-x64/arm64, darwin, win32) | optional per-platform | prebuilt only |
| `@xterm/xterm` + `@xterm/addon-fit` | 6.0.0 / 0.11.0 | 5.9 MB / 21 KB | none | no |
| `ws` | 8.22.0 | 151 KB | none | already in Piano's lockfile (`package-lock.json:12752`) |

Sources: N1, N2, L8. Piano today: `effect`, `@effect/platform-node`, Pi and `file-type` on the
server; the web app has no terminal library. No `pty` string appears in `package-lock.json`. [L8]

## 4. Embeddability

- **Browser:** yes. `Terminal` is an ordinary React 19 component; `@wterm/react/css` is one
  stylesheet; the WASM is embedded, so Vite needs no asset copying (the example copies it to
  `public/` only to serve it separately). `autoResize` fits the container. [W5, W3]
- **Server:** no module to mount. `server.ts` creates its own `http.Server`, hands `/api/terminal`
  upgrades to a `ws` server and everything else to Next. Reusing it means porting ~1,100 lines of
  example code (`server.ts`, `terminal-sessions.ts`, `pty-output.ts`, `pty-output-queue.mts`,
  `terminal-protocol.ts`) and its browser half (`terminal-connection.ts`, 459 lines). [W7–W9]

## 5. Security model of the example

No authentication, no origin check, no allowlist: any WebSocket reaching `/api/terminal` gets a
login shell as the server's OS user with the server's full environment, starting in `$HOME`, not a
workspace. The only limits are counts and bytes. It binds `127.0.0.1` by default. [W7, W8]

For Piano this matters because INV-11 says loopback alone is not protection and the server has no
application authentication; the practical-runners note repeats that "loopback TCP alone is not
protection from other local users/processes". Pi's own `bash` tool already runs commands as the
server user, so a terminal adds no new privilege class, but it adds a **model-free, interactive**
path to it. INV-09 already names unrestricted shell access as a potential gate bypass. [L2, R1]

## 6. Theming

All colors are CSS custom properties on `.wterm`: `--term-fg`, `--term-bg`, `--term-cursor`,
`--term-color-0..15`, `--term-font-family`, `--term-font-size`, `--term-line-height`,
`--term-row-height`; themes are classes (`theme-light`, `theme-monokai`, …). `.wterm` also sets
`padding: 12px`, `border-radius: 8px` and a drop shadow that Piano would override to sit flat in the
sheet. `setThemeColors()` takes 24-bit integers and matters only for the Ghostty core's OSC 10/11
query replies. Piano's tokens are `oklch()` values under `:root` and `.dark` (`--conversation`,
`--surface-1`, `--ink`, `--line`); for the built-in core, `--term-bg: var(--conversation)` and
`--term-fg: var(--ink)` under `.wterm` and `.dark .wterm` should be enough, and the 16 ANSI colors
need a Piano palette (Piano has status hues, not an ANSI set). The mono font is the system mono
stack Piano already uses (`font-mono`). Unverified visually. [W4, L8]

## 7. Piano fit

**Server.** Effect's `ChildProcess.make` options are `cwd`, `env`, `extendEnv`, `shell`, `detached`,
`stdin`/`stdout`/`stderr` as pipes; nothing allocates a pseudo-terminal, and the platform-node
child-process guide covers pipes only. `PiTransport` and `Subprocess.ts` both build on pipes;
`Subprocess.run` is deliberately non-interactive (stdin closed, bounded stdout, `okCodes`, timeout,
process group). A PTY therefore means a new native dependency, whatever the client. [L4, L9]

**WebSocket and origin.** `Router.ts` upgrades `/ws` with `request.upgrade` and hands the socket to
`WsClient.handleSocket`, a JSON-text protocol with bounded delivery and acknowledgements. Its global
middleware returns 403 for `/ws`, for **any** request with an `Upgrade` header and for non-GET
methods unless `Origin` is in `AllowedOrigins` (`PIANO_ALLOWED_ORIGINS`, exact origins only). A second
upgrade route such as `/ws/terminal` inherits that check for free. `main.ts` already destroys
upgraded sockets on SIGINT/SIGTERM. [L3]

**Paths out of URLs.** Routes take `?workspaceId=` and resolve it through `Registry.workspace` to
`Workspace { id, folder, path }`; a terminal socket must do the same and spawn in `workspace.path`,
never accept a path from the browser. [L1, L3, L5]

**Where it lives.** `SidebarPanel = "changes" | { kind: "file"; path }` (`lib/navigation.ts`);
`SessionPanel` renders `ChangesPanel` or `WorkspaceFile` inside `RightSidebar`, which provides the
header (title, description, actions, Close), optional toolbar and footer, a 320–1024 px remembered
width (default 480) on desktop and a full-width `PianoSheet` below the breakpoint. Links is a
popover from the usage row and Context a details view; neither is a sidebar panel. Changes is opened
by the session command `changes` (`intent.kind: "changes"` → `effects.openPanel("changes")`), listed
in `HEADER_SECTIONS.open` and the palette's Session commands group. A terminal follows the same
path: a `terminal` session command named as its button, so the AGENTS.md palette rule holds. [L6, L7]

**`WorkspaceCommands.ts`** is worktree discovery/creation and trust, not command execution;
`WorkspaceChanges.ts` is bounded Git reading. A terminal is a new seam, not an extension of either.
Pattern to copy: a `Context.Service` whose external binary is a `Context.Reference` (like
`GitCommand`) so module tests supply a fake. [L4]

**Invariants.** INV-01: terminal output is ephemeral workspace observation, never written to the
registry and never presented as session history; Pi's bash tool results remain the only recorded
commands. INV-02 analogue: the server owns the PTY; a dropped socket must not duplicate shells.
INV-07: every terminal carries `workspace.id` and its cwd; switching workspaces must not relabel
one. INV-09: a shell is a gate bypass by definition; keep it visibly outside evidence. INV-11: the
most powerful endpoint on an unauthenticated server; origin check plus loopback is the whole guard,
and the exe.dev deployment must stay behind private access. [L2, L11]

## 8. Options

| | A. Embed wterm as-is | B. wterm client + Piano Effect server | C. `@xterm/xterm` + `node-pty` | D. Non-PTY command runner |
| --- | --- | --- | --- | --- |
| Dependencies added | Not possible: no server package; porting the Next.js example brings `ws` usage patterns, `node-pty`, ~1.5 kLOC of example code | `@wterm/dom`, `@wterm/react` (≈ 0.8 MB unpacked, 0 transitive deps) + one PTY package | `@xterm/xterm`, `@xterm/addon-fit` (≈ 5.9 MB unpacked) + one PTY package | none (`Subprocess.ts`, shadcn `ScrollArea`/`pre`) |
| Native build risk | node-pty: none on macOS, **compiler on Linux/exe.dev** | same PTY risk; `@lydell/node-pty` avoids it but is beta | same as B | none |
| Security exposure | full login shell in `$HOME`, server env, no origin check | shell in the workspace, Piano origin check, Piano limits; still an interactive shell on the no-auth server | same as B | one process per command, closed stdin, bounded output, timeout; still arbitrary commands as the server user |
| UX fidelity | full (interactive, colors, resize, reconnect, cwd) | full for the built-in core; Ghostty optional | full; canvas renderer, no native selection | no interactive programs, no prompts, TTY-detecting tools drop color; output pane only |
| Effort (days) | 3–5 to port, then diverge from upstream | 3–4 | 3–4 | 1.5–2 |
| INV-01 | n/a | ephemeral; nothing persisted | same | same; results are observations, not evidence |

## 9. Recommendation and gates

Prefer **B** over C: equal server work, far smaller client, DOM-native selection and find, and the
same PTY problem. Prefer **D** over B when the stated need stays "a few commands occasionally" and
no interactive program is expected. Gates, in order:

- **G0 — UX decision.** List the commands actually run from Piano in a week. If none is interactive
  (`git rebase -i`, package-manager prompts, `gh auth`, pagers), build D and stop.
- **G1 — PTY installs without a compiler on both hosts.** On the exe.dev VM (`/home/exedev/.local/bin/node`,
  Node 24, Linux) and on macOS, `npm install` of the chosen PTY package must succeed with install
  scripts gated as Piano's `allowScripts` block gates them today. `node-pty` 1.1.0 fails this on Linux
  unless `python3`, `make` and `g++` are present; `@lydell/node-pty` passes only if a beta is accepted
  (or a stable release appears). Record versions and the observed install output.
- **G2 — Security note in the PR.** Cite INV-09 and INV-11: no new listener, origin check applies to
  the upgrade, workspace resolved by ID, shell spawned in `workspace.path` with Piano's existing env
  policy, bounded sessions (one per workspace per client), killed on panel close. No persistence.
- **G3 — Theme and layout check.** `.wterm` inside `RightSidebar` in light and dark, resize of the
  column fits the grid (`autoResize`), `test/browser/style-shots.mjs` before/after since `index.css`
  gains tokens.
- **G4 — Fake PTY module test.** The `WorkspaceTerminals` interface is tested with a fake spawner
  (resize before spawn, bounded output, socket drop kills or keeps per the chosen policy, second
  open for the same workspace is refused), no real shell.

## 10. Smallest useful slice (option B)

- **Wire.** A terminal is workspace-scoped, not a Pi session capability, so it is not a
  `SessionAction`/`SessionEvent`. Add a second upgrade route `GET /ws/terminal?workspaceId=<id>`
  (ID only, resolved like the HTTP routes) carrying wterm-style frames: text JSON `resize { cols, rows }`
  and `input { data }` from the browser, binary PTY bytes and text `exit { code }` from the server.
  Keep the first `resize` as the spawn trigger. Bound input (64 KiB) and output with the socket's
  `bufferedAmount`, pausing the PTY above a window as the example does. Browser side: the stock
  `WebSocketTransport` from `@wterm/core` is enough for bytes; `resize` goes through `Terminal`'s
  `onResize`.
- **Server.** `server/WorkspaceTerminals.ts` exporting `WorkspaceTerminals` (a `Context.Service` with
  `open(workspace, size)` → handle `{ write, resize, output, exited, close }`) and a `PtySpawner`
  `Context.Reference` wrapping the PTY package, so tests pass a fake. `Router.ts` adds the upgrade
  route; the existing origin middleware covers it.
- **UI.** `SidebarPanel` gains `"terminal"`; `web/src/components/TerminalPanel.tsx` renders
  `RightSidebar` (label "Terminal", title with `BranchLabel`, description `abbrevHome(path)`, an
  `IconButton` "Restart" action) around `<Terminal autoResize onData onResize onReady>` from
  `@wterm/react`, with `@wterm/react/css` imported once and a `.wterm` override block in `index.css`
  mapping `--term-*` to Piano tokens. `sessionCommands.ts` gains `terminal` ("Terminal", group
  `open`, icon `terminal`), `commands.ts` maps it to `openPanel("terminal")`, so the header button
  and the palette row share the name. No new global shortcut (AGENTS.md).
- **Checks.** Module test through `WorkspaceTerminals` with the fake spawner (G4). Evidence, not a
  committed journey: an uncommitted `agent-browser` script on a scratch instance (ports 7171/7172)
  that opens a seeded session, runs the palette command "Terminal", types `printf 'PIANO_OK\n'`,
  asserts the `.wterm` text contains `PIANO_OK` and screenshots light and dark; attach with
  `gh pr comment --attach`. A terminal is not a critical path, so nothing is added to `test/browser/`.

## Not verified

No wterm build or example was run; no package was installed; the `.wasm` was not loaded. Bundle
sizes are unpacked registry sizes. Whether the exe.dev VM has a C++ toolchain, whether Piano's
`allowScripts` configuration blocks `node-pty`'s install script, how `@wterm/dom` renders inside
`RightSidebar`, and the stability of `@lydell/node-pty`'s beta are all unobserved. An alternative
PTY without a native module, the system `script(1)` utility, was not evaluated (flag sets differ
between macOS and util-linux).

## Sources

wterm, inspected at `488e9a7344e812e35a951f803618d7767cc4be5b`:

- **W1:** [README](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/README.md): packages, features, "Vercel Labs experiment".
- **W2:** [package.json](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/package.json), [pnpm-workspace.yaml](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/pnpm-workspace.yaml) (`allowBuilds: node-pty: true`), [build.zig.zon](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/build.zig.zon), `.node-version`.
- **W3:** `@wterm/core`: [package.json](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/packages/%40wterm/core/package.json), [src/index.ts](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/packages/%40wterm/core/src/index.ts), [src/transport.ts](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/packages/%40wterm/core/src/transport.ts), [scripts/inline-wasm.js](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/packages/%40wterm/core/scripts/inline-wasm.js), [src/wasm-loading.ts](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/packages/%40wterm/core/src/wasm-loading.ts), [README](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/packages/%40wterm/core/README.md).
- **W4:** `@wterm/dom`: [package.json](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/packages/%40wterm/dom/package.json), [src/terminal.css](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/packages/%40wterm/dom/src/terminal.css), [src/wterm.ts](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/packages/%40wterm/dom/src/wterm.ts), [README §Themes](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/packages/%40wterm/dom/README.md).
- **W5:** `@wterm/react`: [package.json](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/packages/%40wterm/react/package.json), [src/Terminal.tsx](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/packages/%40wterm/react/src/Terminal.tsx), [README](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/packages/%40wterm/react/README.md).
- **W6:** `@wterm/ghostty` [package.json](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/packages/%40wterm/ghostty/package.json) and `wasm/ghostty-vt.wasm` size.
- **W7:** [examples/local/server.ts](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/examples/local/server.ts).
- **W8:** [terminal-protocol.ts](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/examples/local/lib/terminal-protocol.ts), [terminal-sessions.ts](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/examples/local/lib/terminal-sessions.ts), [pty-output.ts](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/examples/local/lib/pty-output.ts), [terminal-connection.ts](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/examples/local/lib/terminal-connection.ts).
- **W9:** [examples/local/package.json](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/examples/local/package.json) and [README](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/examples/local/README.md).
- **W10:** [CHANGELOG.md](https://github.com/vercel-labs/wterm/blob/488e9a7344e812e35a951f803618d7767cc4be5b/CHANGELOG.md); tags `v0.5.1`–`v0.5.4`.

Registry metadata (read 2026-10-16):

- **N1:** `npm view` of `@wterm/core`, `@wterm/dom`, `@wterm/react`, `@wterm/ghostty` 0.5.4;
  `node-pty` 1.1.0; `@lydell/node-pty` 1.2.0-beta.15 and its platform packages; `@xterm/xterm` 6.0.0,
  `@xterm/addon-fit` 0.11.0; `ws` 8.22.0.
- **N2:** `npm pack node-pty@1.1.0 --dry-run --json`: 28 `prebuilds/` entries, all `darwin-*` or
  `win32-*`, zero `linux`; `scripts.install = "node scripts/prebuild.js || node-gyp rebuild"`.
  Upstream: [microsoft/node-pty](https://github.com/microsoft/node-pty).

Piano at `3509b5ba5a5ced3300cc6226aaa1ac56ebe78601`:

- **L1:** [AGENTS.md](../../AGENTS.md): palette rule, paths out of URLs, scratch instance, module naming.
- **L2:** [glossary](../glossary.md), [invariants](../development-invariants.md) INV-01/02/07/09/11, [ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md) §Alternatives.
- **L3:** [server/main.ts](../../server/main.ts), [server/Router.ts](../../server/Router.ts), [server/OriginPolicy.ts](../../server/OriginPolicy.ts), [server/WsClient.ts](../../server/WsClient.ts).
- **L4:** [server/PiTransport.ts](../../server/PiTransport.ts), [server/Subprocess.ts](../../server/Subprocess.ts), [server/WorkspaceCommands.ts](../../server/WorkspaceCommands.ts), [server/WorkspaceChanges.ts](../../server/WorkspaceChanges.ts).
- **L5:** [shared/wire.ts](../../shared/wire.ts): `Workspace`, `SessionAction`, `ClientMessage`, `ServerMessage`.
- **L6:** [RightSidebar.tsx](../../web/src/components/RightSidebar.tsx), [SessionPanel.tsx](../../web/src/components/SessionPanel.tsx), [AppLayout.tsx](../../web/src/components/AppLayout.tsx), [Changes.tsx](../../web/src/components/Changes.tsx), [lib/navigation.ts](../../web/src/lib/navigation.ts), [lib/panelLayout.ts](../../web/src/lib/panelLayout.ts).
- **L7:** [CommandPalette.tsx](../../web/src/components/CommandPalette.tsx), [lib/commandPalette.ts](../../web/src/lib/commandPalette.ts), [lib/globalCommands.ts](../../web/src/lib/globalCommands.ts), [lib/sessionCommands.ts](../../web/src/lib/sessionCommands.ts), [lib/commands.ts](../../web/src/lib/commands.ts).
- **L8:** [web/src/index.css](../../web/src/index.css), [web/package.json](../../web/package.json), [package.json](../../package.json) (`allowScripts`), `package-lock.json` (`ws` present, no `pty`).
- **L9:** installed `node_modules/effect/src/process/ChildProcess.ts` (spawn options) and `node_modules/@effect/platform-node/ai-docs/src/60_child-process/`.
- **L10:** [test/browser/harness.mjs](../../test/browser/harness.mjs), [transcript-rows.mjs](../../test/browser/transcript-rows.mjs).
- **L11:** [deploy/systemd/piano.service](../../deploy/systemd/piano.service), [hosted development](../hosted-development.md).
- **R1:** [practical remote runners](2026-10-14-practical-remote-runners.md): minimal-dependency constraint and loopback caveat.

## Verification

Documentation-only research on the developer's macOS machine. Checked: source paths and quoted
constants against the checkout, registry figures against `npm view`, Piano file paths and relative
links, and the separation between observed contracts and proposals. No tests, app run, browser
journey, installation or model call.
