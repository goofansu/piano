# Browser storage

Rules for anything the web UI keeps in `localStorage` or `sessionStorage`. Server-side storage is
in [configuration and storage](configuration.md).

## Choose the key and the store

Answer three questions about the value, in order.

1. **Whose is it?**
   - **A machine's:** it is named by that machine's paths, session IDs or project IDs, or it
     caches that machine's answer. Key: `piano.machine.<id>.<name>`.
   - **This browser's:** how the person likes Piano to look or behave on every machine.
     Key: `piano.<name>`. The folder picker's last path (`piano.pickerPath`) is kept here too: the
     picker lists only Local's directories.
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

Add the name to `MACHINE_MEMORY` in `web/src/lib/machineMemory.ts` and use `machineMemory`.

## This browser's preferences

Create one with `createPreference` (`web/src/lib/preference.ts`) under a fixed `piano.<name>` key.

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
