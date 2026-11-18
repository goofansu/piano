# Configuration and storage

## Environment variables

Read where they are used: `grep -rn "process\.env\." server scripts web/vite.config.ts`.

## Piano's extensions

`server/PiCli.ts` loads the extensions under `extensions/` by absolute path from the Piano
installation, before the session arguments, so a repository cannot supply or shadow them and a
`-e` in `PIANO_PI_ARGS` adds an extension instead of replacing Piano's.

### Claude Code

`@earendil-works/pi-claude-code` is pinned in `package.json` to a commit of the
[goofansu/pi-claude-code](https://github.com/goofansu/pi-claude-code) fork.

**Avoid duplicate installations.** If the same plugin is also installed in user or project Pi
settings, Pi can load both copies: paths are deduplicated, not package identity across separate
installations. Provider registrations can override each other, status commands get numbered
suffixes, and initial model availability can be inconsistent. Piano does not suppress or remove
the other copy. Use only the bundled copy in the Pi environment used by Piano; if standalone Pi
needs a separate installation, keep that in a separate Pi environment.

Claude Code installation and authentication remain external. Install Claude Code separately and
run `claude auth login` in a terminal as the user running Piano. Its executable must be on the
Piano backend's `PATH`, or set `PI_CLAUDE_CODE_COMMAND` to its absolute path. For a nondefault
Claude configuration directory, set `PI_CLAUDE_CODE_CONFIG_DIR`; the plugin passes it to Claude
as `CLAUDE_CONFIG_DIR`. Piano does not copy or manage Claude credentials.

## Session dispatch

`server/SessionEndpoint.ts` gives each Pi child `PIANO_SESSION_WS_URL` and
`PIANO_SESSION_ORIGIN`. The origin is chosen from the configured set, never added to it, so
starting a child cannot widen the [origin policy](#browser-origins). See
[session dispatch](session-dispatch.md).

## Browser origins

`server/OriginPolicy.ts` owns the Origin and Host checks. The origin check blocks cross-site
browser requests; it is not authentication, because a client outside a browser can set any
`Origin`, and it does not replace private access. Never allow an origin that serves untrusted
generated previews. Behind a proxy or on a custom Vite port, list the origin the browser uses,
not the backend address. For the exe.dev setup, see
[origin configuration](hosted-development.md#origin-configuration).

## Registry storage

`server/RegistryDatabase.ts` owns the SQLite schema and its in-place upgrades. Run one backend
per database: when a second backend writes, the first backend's next write fails, and that
backend needs a restart. SQLite runs in WAL mode: to back up by copying files, stop Piano first;
while Piano runs, use SQLite's backup API.
