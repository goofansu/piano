# Browser storage

Rules for anything the web UI keeps in `localStorage` or `sessionStorage`. Server-side storage is
in [configuration and storage](configuration.md).

## Choose the store

Answer two questions about the value.

1. **How long should it live?**
   - **With the tab:** it describes what this tab is showing now. Store: `sessionStorage`.
   - **Until changed:** a choice, or a cache worth having next week. Store: `localStorage`.
2. **Should two open tabs agree?**
   - **Yes:** a preference. Store: `localStorage`.
   - **No:** each tab does its own work. Store: `sessionStorage`.

The two normally agree. When they differ, question 2 decides: two tabs overwriting each other is
a visible bug, while a value lost when a tab closes is an inconvenience.

Then check two things before storing it at all:

- **Staleness:** what happens when the stored value is old? A model list is replaced by the
  server's answer a moment later, so it may be stored. An unsent draft could be sent by mistake,
  so drafts and question replies stay in page memory.
- **Removal:** name what deletes it. `sessionStorage` ends with the tab. A fixed `piano.<name>`
  key is one bounded key. A value with no such answer stays out of `localStorage`.

## Names

Every key is `piano.<name>`, with `<name>` in camelCase (`piano.messagesOnly`, `piano.lastDir`).
A library that stores its own key is given a `piano.` name through its options, as `next-themes`
is given `piano.theme`.

## What Piano remembers about its own data

A value named by Piano's paths, session IDs or project IDs, or caching the server's answer: add
the name and its store to `BROWSER_MEMORY` in `web/src/lib/browserMemory.ts` and use
`browserMemory`.

## Preferences

How the person likes Piano to look or behave: create one with `createPreference`
(`web/src/lib/preference.ts`) under a fixed `piano.<name>` key.

## Renaming or retiring a key

A renamed key forgets what people saved unless it is carried over. The inline script in
`web/index.html` runs before the first paint and before any reader: add a `[former, key]` pair
there to carry a value across once and remove the former key, or a `removeItem` for a key nothing
reads. Keep `piano.theme` identical in that script and in `ThemeProvider`'s `storageKey`
(`web/src/main.tsx`); a mismatch flashes the wrong theme on load.

## Reading and writing

Storage can be missing or blocked (private windows, embedded webviews, cleared site data). Read
through a fallback and treat every write as best effort: use `createPreference`, `browserMemory`,
the helpers in `web/src/lib/storage.ts`, or a `try`/`catch` of the same shape. Treat a stored
value as untrusted input and validate it on read.
