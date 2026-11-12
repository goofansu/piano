# Quiet UI

The rules every screen, string and control in Piano follows; the design language behind
them is in [Moonstone](design-moonstone.md#linear).

## Checks

A screen carries only what helps the user decide or act, and explains itself (Krug's "don't make
me think") through structure, names and defaults. Every string, control and action a change adds
passes these checks:

- **Kind:** a value, a control's name, a state, or an empty state's one line. Explaining the screen
  (helper sentences, field descriptions, placeholders, intro lines) means a name or layout needs
  work: fix that instead. A fact only words can carry waits in a Details popover or a dialog's
  description line.
- **Once:** each fact appears once per screen. A header's context line, a title or a placeholder
  holds only what the screen does not already show.
- **Same names:** things are named as the UI and [the glossary](glossary.md) already name
  them, case included ("No project", "Delete project").
- **Same shape:** a new screen matches an existing screen of its kind (a settings page matches
  Webhooks); compare their screenshots side by side. A destructive action is the red
  `destructive` menu item, last in its menu after a separator, and asks first.
- **Feedback:** every action answers where it was taken, once the server confirms it: a saved,
  deleted or sent change ends with a toast that names it ("Project saved", "Session deleted"),
  a failure with the error's toast, a read in progress with its own control turning.
- **Details on demand:** internal state and diagnostics go in on-demand details, if anywhere; a
  persistent warning appears only for a problem the user can act on.

## Button names

- **New** opens creation; use `New <noun>` for the entry button, matching palette command and
  dialog title (for example, New project, New skill, New prompt, New webhook).
- **Create** confirms creation; use `Create <noun>` and success feedback `<Noun> created`.
  Edits keep **Save** and `<Noun> saved`.
- **Add** configures or imports an existing resource (Add MCP server, Add key), inserts an
  inline row (Add header, Add variable), or makes an association (Add to project, Add to chat).
  Choose the verb by the action, not by replacing every Add.
- The entry button, its palette row and the dialog's confirm share one verb and noun ("Add MCP
  server" opens a dialog whose button is "Add MCP server").
- A creation entry button (New project, New webhook, New skill, New prompt, Add MCP server)
  carries the plus icon; the pen icon belongs to New session alone.
- A toast names the change with no trailing period ("Webhook saved", "Signed out of Radius"); a
  switch answers "<Noun> turned on" / "<Noun> turned off"; a failure begins "Could not …". A copy
  from a menu answers with a toast ("Branch copied"); a copy button answers in place, its icon
  turning to a check (`CopyButton`, `useCopy`).
- A list or picker with no match says "No <noun> matches."; an empty page section says
  "No <nouns> yet".
- A control beside a value acts on that value, and its name says so ("Copy branch" beside the
  branch, "Copy directory path" beside the directory).

## Shared structure

Shared structure, so every pane reads as one app: one header shape on the session, the right
sidebar and Settings (a title, context beside or beneath it when that adds something, controls at
the end). The session header adds folder/ref context beneath its title when its menu is a
sheet (one-area-at-a-time or a narrow viewport). On a wide viewport it keeps the project breadcrumb
and menu beside the title, even one-area-at-a-time; on a narrow viewport the menu moves to the end
and replaces the breadcrumb as the route to project actions;
one status glyph, `StatusDot`, for every state (an app preview, a webhook delivery), breathing
(its `busy` tone) only while something is in progress, and each state shown once: the sidebar row owns a
session's state, so the header repeats nothing; a refresh control turns its own icon while it
reads; a page listing things (providers, webhooks, the Projects index) is `SettingsGroup`s and
`SettingsList`s of hairline-divided rows (`settingsRow` draws the hairline, each row is a
`listitem`) in one `max-w-2xl` column on `PaneBody`, with no fill behind the list, its one
primary action in its header, and a configured thing's actions in its `ListRow`'s `RowMenu`, a
ghost ⋯ menu (the verb that configures a thing, Sign in, Add key, Connect, stays an `outline`
text button); a state in a row is `StatusDot` beside its word ("Signed in", "Ready"), never an
icon alone; an empty list is one `Empty` line, the section's icon and "No <nouns> yet", at
`py-8`; a row's second line is `text-xs`; editing one thing's few fields (Project settings) is a
dialog opened where the thing is shown, its fields in place and Save in its footer.

A session row's menu is one menu wherever the row appears (the sidebar, a project's home):
Rename, Pin, the project items, then Archive and Delete last after a separator; the palette's
Session commands end the same way, Delete red. A branch under a session's title is a quiet sans
label; elsewhere a branch, path, file name or model id is mono, and a folder's name is sans.

## Dialogs

A form dialog (New project, New webhook, Add MCP server, an API key, Rename) shows the close
control and a Cancel button, puts Cancel first in its footer, keeps its confirm button disabled
until its required fields are filled, and while busy keeps the button's label and shows a
`Spinner` as `data-icon="inline-start"` before it (never "Saving…"). It is a `FormDialog`, so
an outside click never discards it (Escape, the close control and Cancel do) and while busy
nothing closes it and the close control hides. A dialog with several
fields is `sm:max-w-xl`; one with one field, or a confirmation, is `sm:max-w-md`. A
confirmation is `RemovalDialog`: no close control, outside clicks blocked, "<Verb> <noun>?" as
its title, one line that says what stops, and the verb as its button; its words are the
action's (a Delete says "deleted", not "removed"). Field group titles inside a form are
`FieldLegend variant="label"`, the size of the other labels. Fields carry no example
placeholders.

## Icon buttons and row actions

An icon-only button takes its size from its place, `size="header"`, `"list"`, `"row"` or
`"inline"` on `PianoButton` and `IconButton`, never a pixel size or a touch override of its own:
a header or toolbar (a pane's, the sidebar's, a picker's, a Settings group's) and a list row's
action outside the sidebar are 32px, 44px on touch; a sidebar row's are 24px, 36px on touch;
a control inside content (a code block, a quote, the PDF toolbar) is 24px. A one-off (the
composer's Attach and Send, Scroll to bottom, the session menu sheet's) and a button inside a field
(`InputGroupButton`) keep their own sizes. A control that is 44px on a phone as well as on touch
(a picker, a view toggle, the composer's actions) writes that size, and its mouse size under
`compact:` (a wide screen without a coarse pointer), never under `md:` alone, which would shrink it on a
wide touch screen. A row's actions are `RowActions`: over the row's end,
revealed while it is pointed at, focused or has its menu open, its text fading or its value
stepping aside beneath them, so the row reserves no empty slot. A list row is `ListRow`, which
places them (its ⋯ ends where an in-flow action would, on the row's padding) and decides the fade
and the step aside; beside a call to action (Install, Reconnect) or an interactive control (a
switch), its ⋯ stays in the row's flow. The only thing that steps aside is the row's
`time`; interactive controls go in `ListRow.actions`, so their hit targets stay stationary and
separate from the menu.

## Components

Build UI from shadcn/ui components (the `shadcn` skill: search the registry, add with
`npx shadcn@latest add`). Hand-written markup is for the case where no standard component exists,
and says so in a comment. `web/src/components/ui/` stays upstream-owned: Piano's variants, overlay
styling and focus policy live in the `Piano*` wrappers and `StatusBadge` in
`web/src/components/`, and tokens in `web/src/index.css`. Before adding a customization or
upgrading shadcn, read [the ownership and upgrade guide](shadcn-ui.md); review every
`--diff` before writing over a file in `ui/`.

## Links and icons

An outgoing link in Settings is a `SettingsExternalLink` (text followed by the external-link icon,
opened in a new tab); a button that leaves Piano ends with the same icon as `data-icon="inline-end"`.
In a menu with leading action icons, external links use that same leading column so labels align.

A project's icon is the target; the folder icon means a folder (an added root) and nothing else,
so "Open project", "Move to project" and a project picker's rows show the target, "Remove from
project" the circle-minus, and "No project" the circle-off.

Branding icons use [Simple Icons](https://simpleicons.org/). Bundle SVGs locally, preserve source
and license attribution, and use `currentColor` to match the UI; see `web/public/mcp-logos.svg`.

## Command palette and shortcuts

The command palette on Mod+K (`web/src/components/CommandPalette.tsx`, whose name, groups, headings
and `!p` scope `web/src/lib/commandPalette.ts` decides) is the keyboard surface for
navigation and view commands, grouped as Sessions (Recent sessions before searching), Projects,
Global commands and Session commands (only with a selected session). Projects lists active projects
by name and opens their pages; done projects remain reachable through the Projects index. A leading,
standalone lowercase `!p` scopes results to active project navigation (`!p` browses, `!p launch`
searches names). The placeholder is **Search sessions, projects and commands…**, while the field
and dialog keep the full accessible name **Search sessions, projects and commands**. There is no
persistent filter hint, filter button or footer. A standalone `!` (ignoring surrounding whitespace)
offers only **Projects only · !p** in the results. Enter or a click inserts `!p `, retaining input
focus and the open palette. Other tokens such
as `!s`, `!c`, `!P` and `!pizza` are ordinary queries, not filters. A session's outputs are read in its
session rail, not searched from the palette. A feature that adds an action the sidebar or header offers also adds
a row in the appropriate command group, named as its button is, including a toggle, whose row
reads its state ("Hide sidebar" while the sidebar is shown, "Show sidebar" while it is hidden). An
icon button's label, its tooltip and the palette's name for the same surface are one string
("Search sessions, projects and commands").
Global shortcuts are Mod+K (palette) and Sidebar's ⌘B (not Ctrl+B); the composer alone binds Mod+/ to
its model picker. Other actions are reached through the palette or their control.
