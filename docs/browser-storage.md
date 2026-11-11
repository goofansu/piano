# Browser storage

Rules for anything the web UI keeps in `localStorage` or `sessionStorage`. Server-side storage is
in [configuration and storage](configuration.md).

## Choose the key and the store

Answer three questions about the value, in order.

1. **Whose is it?**
   - **A machine's:** it is named by that machine's paths, session IDs or project IDs, or it
     caches that machine's answer. Key: `piano.machine.<id>.<name>`.
   - **This browser's:** how the person likes Piano to look or behave on every machine.
     Key: `piano.<name>`.
2. **How long should it live?**
   - **With the tab:** it describes what this tab is showing now. Store: `sessionStorage`.
   - **Until changed:** a choice, or a cache worth having next week. Store: `localStorage`.
3. **Should two open tabs agree?**
   - **Yes:** a preference. Store: `localStorage`.
   - **No:** each tab does its own work. Store: `sessionStorage`.

Questions 2 and 3 normally agree. When they differ, question 3 decides: two tabs overwriting each
other is a visible bug, while a value lost when a tab closes is an inconvenience.

Then check two things before storing it at all:

- **Staleness:** what happens when the stored value is old? A model list is replaced by the
  machine's answer a moment later, so it may be stored. An unsent draft could be sent by mistake,
  so drafts and question replies stay in page memory.
- **Removal:** name what deletes it. `sessionStorage` ends with the tab. A fixed `piano.<name>`
  preference is one bounded key. A machine's keys are swept by `forgetUnconfiguredMachines`. A
  value with no such answer stays out of `localStorage`.

## Names

Every key is `piano.<name>` or `piano.machine.<id>.<name>`, with `<name>` in camelCase
(`piano.messagesOnly`, `piano.machine.eng-1.lastDir`). A library that stores its own key is given
a `piano.` name through its options, as `next-themes` is given `piano.theme`.

## A machine's memory

`web/src/lib/machineMemory.ts` is the single source of truth: `MACHINE_MEMORY` lists each name
with its store, `machineKey` builds the key, and `machineMemory(machineId, name)` reads, writes and
removes it in the store the table names. Readers only encode and decode; none picks a store.
Local is the machine `local`, with the same keys as any other.

| Name | Store | Holds |
| --- | --- | --- |
| `catalogs` | `localStorage` | Model catalogs by directory, shown until the machine answers |
| `lastDir` | `localStorage` | The directory a session last started in |
| `openGroups` | `localStorage` | The sidebar's folder and project groups left open |
| `surface` | `sessionStorage` | The Surface area's open tabs |
| `location` | `sessionStorage` | The page this tab was on, for the next switch back |

To remember something new for a machine, add its name to `MACHINE_MEMORY` and read and write it
through `machineMemory` (its `preference` gives a `createPreference` value on the same key). The
sweep then covers it: when the server answers the machine list, `forgetUnconfiguredMachines`
removes, in each store, every key of a machine no longer configured and every machine key
`MACHINE_MEMORY` does not place in that store. Moving a name to the other store or retiring it
therefore needs no separate cleanup.

The ID is the configured one and the browser's only identity for a machine. A renamed ID starts
with nothing remembered.

## This browser's preferences

Create one with `createPreference` (`web/src/lib/preference.ts`) under a fixed `piano.<name>` key.
It reads through a fallback, stays in step with other tabs, and survives blocked storage. Current
ones cover the theme, the sidebar and its view options, the session rail, panel width, queue mode,
Messages only and code wrap.

## Renaming or retiring a key

A renamed key forgets what people saved unless it is carried over. The inline script in
`web/index.html` runs before the first paint and before any reader: add a `[former, key]` pair
there to carry a value across once and remove the former key, or a `removeItem` for a key nothing
reads. Keep `piano.theme` identical in that script and in `ThemeProvider`'s `storageKey`
(`web/src/main.tsx`); a mismatch flashes the wrong theme on load.

## Reading and writing

Storage can be missing or blocked (private windows, embedded webviews, cleared site data). Read
through a fallback and treat every write as best effort: use `createPreference`, `machineMemory`,
the helpers in `web/src/lib/storage.ts`, or a `try`/`catch` of the same shape. Treat a stored
value as untrusted input and validate it on read, as `machineLocationMemory` accepts only a path
within a machine.
