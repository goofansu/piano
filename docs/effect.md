# Effect

How Piano's server writes Effect 4 code.

## Versions

Keep Effect packages on aligned versions, and verify lockfile upgrades.

## Writing Effect code

First read `node_modules/effect/AGENTS.md`, the installed version's own guide; prefer it and the
installed examples in `node_modules/effect/ai-docs/src` to web docs or memory. Name a traced
function `Effect.fn("Module.name")`; use `Effect.fnUntraced` on per-event hot paths.

## Gotchas

Both already paid for: on an upgraded socket, acquire `reader` before `writer`
(the reader performs the handshake and the writer waits on it); and a `forkScoped` fiber must not
`ensuring` on an exit that a later finalizer causes, or shutdown deadlocks.
