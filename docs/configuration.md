# Configuration and storage

## Environment variables

Read where they are used: `grep -rn "process\.env\." server scripts web/vite.config.ts`.

## Piano's extensions

`server/features/sessions/pi/PiCli.ts` loads the extensions under `extensions/` by absolute path from the Piano
installation, before the session arguments, so a repository cannot supply or shadow them and a
`-e` in `PIANO_PI_ARGS` adds an extension instead of replacing Piano's.

## Session dispatch

`server/features/dispatch/SessionEndpoint.ts` gives each Pi child `PIANO_SESSION_WS_URL` and
`PIANO_SESSION_ORIGIN`. The origin is chosen from the configured set, never added to it, so
starting a child cannot widen the [origin policy](#browser-origins). See
[session dispatch](session-dispatch.md).

## Browser origins

`server/shared/OriginPolicy.ts` owns the Origin and Host checks. The origin check blocks cross-site
browser requests; it is not authentication, because a client outside a browser can set any
`Origin`, and it does not replace private access. Never allow an origin that serves untrusted
generated previews. Behind a proxy or on a custom Vite port, list the origin the browser uses,
not the backend address. For the exe.dev setup, see
[origin configuration](hosted-development.md#origin-configuration).

## Registry storage

`server/shared/registry/RegistryDatabase.ts` owns the SQLite schema and its in-place upgrades. Run one backend
per database: when a second backend writes, the first backend's next write fails, and that
backend needs a restart. SQLite runs in WAL mode: to back up by copying files, stop Piano first;
while Piano runs, use SQLite's backup API.
