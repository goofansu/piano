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

## Shared structure

Shared structure, so every pane reads as one app: one header shape on the session, the right
sidebar and Settings (a title, context beside or beneath it when that adds something, controls at
the end; the session header is one line, with its menu beside the title);
one status glyph, `StatusDot`, for every state (an app preview, a webhook delivery), breathing
(`pulse`) only while something is in progress, and each state shown once: the sidebar row owns a
session's state, so the header repeats nothing; a refresh control turns its own icon while it
reads; a Settings page listing things (providers, webhooks) is `SettingsGroup`s and
`SettingsList`s of hairline-divided rows with `outline` row actions and its one primary action
in its header; editing one thing's few fields (Project settings) is a dialog opened where the
thing is shown, its fields in place and Save in its footer.

## Icon buttons and row actions

An icon-only button takes its size from its place, `size="header"`, `"list"`, `"row"` or
`"inline"` on `PianoButton` and `IconButton`, never a pixel size or a touch override of its own:
a header or toolbar (a pane's, the sidebar's, a picker's, a Settings group's) and a list row's
action outside the sidebar are 32px, 44px on touch; a sidebar row's are 24px, 36px on touch;
a control inside content (a code block, a quote, the PDF toolbar) is 24px. A one-off (the
composer's Attach and Send, Scroll to bottom, the phone sheet's) and a button inside a field
(`InputGroupButton`) keep their own sizes. A row's actions are `RowActions`: over the row's end,
revealed while it is pointed at, focused or has its menu open, its title fading or its value
stepping aside beneath them, so the row reserves no empty slot.

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

Branding icons use [Simple Icons](https://simpleicons.org/). Bundle SVGs locally, preserve source
and license attribution, and use `currentColor` to match the UI; see `web/public/mcp-logos.svg`.

## Command palette and shortcuts

The command palette on Mod+K (`web/src/components/CommandPalette.tsx`) is the keyboard surface for
navigation and view commands, grouped as Sessions (Recent sessions before searching), Global commands
and Session commands (only with a selected session). A session's outputs and links are read in its
session rail, not searched from the palette. A feature that adds an action the sidebar or header offers also adds
a row in the appropriate command group, named as its button is.
Global shortcuts are Mod+K (palette) and Sidebar's ⌘B (not Ctrl+B); the composer alone binds Mod+/ to
its model picker. Other actions are reached through the palette or their control.
