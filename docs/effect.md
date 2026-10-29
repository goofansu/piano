# Effect

How Piano's server writes Effect 4 code.

## Versions

Keep Effect packages on aligned versions, and verify lockfile upgrades.

## Writing Effect code

First read `node_modules/effect/AGENTS.md`: it is the installed version's own
guide, so prefer it to web docs or memory. For idioms, read the installed source and examples in
`node_modules/effect/{src,ai-docs/src}` and `node_modules/@effect/platform-node/{src,ai-docs}`
(child processes: `ai-docs/src/60_child-process`); reference only, import from the packages. Write
a named or service-method effectful function as `Effect.fn("Module.name")(function* …)`, or
`Effect.fnUntraced` on per-event hot paths, not as an arrow returning `Effect.gen`; keep
`Effect.gen` for inline programs and callbacks. Annotate a return type with `Effect.fn.Return<A, E>`.

## Gotchas

Both already paid for: on an upgraded socket, acquire `reader` before `writer`
(the reader performs the handshake and the writer waits on it); and a `forkScoped` fiber must not
`ensuring` on an exit that a later finalizer causes, or shutdown deadlocks.
