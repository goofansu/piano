# Moving Piano's shadcn layer from Radix to Base UI

Research date: 2026-10-15. Status: recommendation, not an implemented migration.
Piano inspected at `23788064ab6b42eb59591adec27fe011f6cef206` (Node v24.19.0, npm 11.17.0).
Upstream checkouts: shadcn-ui/ui `4233ed1` (2026-10-14) and mui/base-ui `cd7829f` (2026-10-14),
cached under `~/.cache/checkouts/github.com/`. Registry items fetched live from `ui.shadcn.com`.

Question: what would it take to move `web/src/components/ui/` from the Radix base
(`radix-vega`) to the Base UI base (`base-vega`), and should Piano do it?

## Answer

**Defer.** Everything needed exists today: shadcn serves a complete `base-vega` registry, every
one of Piano's 35 `ui/` files has a base variant, and shadcn publishes a hand-checked
Radix-to-Base reference. But no cost Piano pays now is removed by the move, Radix is explicitly
not deprecated, and the stock base wrappers hide the `Positioner` node that Piano's overlay
z-index and collision policy would have to live on, so the overlay wrappers would either patch
`ui/` (breaking the zero-patch rule in [shadcn-ui.md](../shadcn-ui.md)) or rebuild their content
from primitives. Details and the plan to run when a trigger arrives are below.

## 1. What shadcn offers for Base UI today

**Three bases, Base UI the default.** The registry defines bases `base` (dependency
`@base-ui/react`), `aria` (`react-aria-components`) and `radix` (`radix-ui`)
([bases.ts][bases]). Since 2026-07-02 "New projects default to Base UI", "Radix is not being
deprecated", and "You do not need to migrate. Radix is a mature, tested library. We still run it
in production today and we're not migrating" ([July 2026 changelog][cl-default]). The same
changelog recommends Base UI for new projects and keeps Radix "one flag away":
`npx shadcn init -b radix`.

**Style names.** Piano's `components.json` has `"style": "radix-vega"`
([components.json](../../web/components.json)); the CLI reports `base radix`, `style vega`,
preset `bIkeymG` (`npx shadcn@latest info`). The CLI derives the base from the style prefix:
`PRESET_BASES.find((base) => style.startsWith(`${base}-`))` ([preset.ts][preset]), so the
Base UI counterpart of Piano's style is `base-vega`. It is served: a dry run from a scratch copy of
`web/` with the style flipped resolved `https://ui.shadcn.com/r/styles/base-vega/<name>.json` for
every requested component (see §4, dry-run output). The `components.json` docs still say the
style "cannot be changed after initialization" ([components-json.mdx][cj-docs]); shadcn's own
migration skill flips it anyway in whole-project mode ("flip `components.json` style
`radix-<style>` -> `base-<style>` now", [SKILL.md][skill] lines 39-41).

**Which package, which version.** Base components import subpaths of `@base-ui/react`
(`@base-ui/react/dialog`, `/menu`, `/select`, `/use-render`, `/merge-props`; counts in the
registry checkout: 18 `merge-props`, 13 `use-render`, 6 `checkbox`, 4 `menu`, 3 `dialog`).
`@base-ui-components/react` is the old name; npm `latest` for it is `1.0.0-rc.0`, while
`@base-ui/react` is `1.9.0` (published 2026-10-09; `npm view … dist-tags`). The registry does
**not** pin a version: the `base-vega` style index lists `"@base-ui/react"` bare
([style.json][style-json]), per-item JSON does not list it at all (`dialog.json` dependencies:
`["cn"]`), and the dry run reported only `+ cn` and `+ cmdk`, never
`@base-ui/react`. Installing it is therefore a manual `npm install` step, and a fresh install
resolves 1.9.0. shadcn's docs app pins `"@base-ui/react": "1.6.0"`
([apps/v4/package.json][v4-pkg] line 33) and its migration tables were "verified against
`@base-ui/react@1.6.0`" ([consumer-props.md][consumer] line 6). Whether 1.7-1.9 changed any
wrapper-visible API is unverified here; the 1.9.0 changelog entries are additive (for example
"Export `CssVariables` and `DataAttributes` types", [CHANGELOG.md][bu-cl]).

**Migration path.** There is no codemod. `npx shadcn migrate --list` offers `cn`, `icons`,
`base-color`, `radix` and `rtl` ([migrate.ts][migrate] lines 14-35); `migrate radix` converts
individual `@radix-ui/react-*` imports to the unified `radix-ui` package
([Feb 2026 changelog][cl-radix]), which Piano already uses. shadcn says "A codemod handles the
components you never touched and breaks on the ones you did. So we shipped knowledge instead"
and ships it as an agent skill: `npx skills add shadcn/ui`, then "migrate accordion to base-ui"
([July 2026 changelog][cl-default]). The skill lives in the repo as
[skills/migrate-radix-to-base/][skill-dir] with reference tables (`universal-patterns.md`,
`overlays.md`, `menus.md`, `consumer-props.md`, `class-mapping.md`, `wrapper-shapes.md`,
`disclosure.md`, `display-misc.md`, `form-controls.md`). Its preferred strategy for a shadcn
project is "golden pair via the CLI": classify each `ui/` file by diffing against its stock
origin, then for pristine wrappers `shadcn add <component> --overwrite`, and for customized ones a
three-way merge ([SKILL.md][skill] lines 30-61). `shadcn apply` switches presets but "keeps the
current base" ([Apr 2026 changelog][cl-apply]).

**Coverage of Piano's 35 `ui/` files.** The base registry directory holds every one of them:
`alert attachment avatar badge button-group button checkbox collapsible command dialog
dropdown-menu empty field input-group input item kbd label popover progress scroll-area select
separator sheet sidebar skeleton slider sonner spinner switch table textarea toggle-group toggle
tooltip` ([registry/bases/base/ui/][base-ui-dir]). Notes per the ones the brief singled out:

| Component | Base variant | Observation |
| --- | --- | --- |
| sidebar | yes | Same file with `Slot`/`asChild` replaced by `useRender` + `mergeProps` and `render` props; composes the base Sheet and Tooltip ([base/ui/sidebar.tsx][b-sidebar]). |
| command | yes | Still cmdk; imports the base `dialog` and `input-group`; `CommandDialog` gains an explicit `children` type (diff radix vs base). Registry deps `cn`, `cmdk`. |
| sonner | yes | Byte-identical to the radix variant (`diff` empty); registry deps `sonner`, `next-themes`. The base docs tree has a `toast` page and no `sonner` page, but the item is served. |
| scroll-area | yes | Same shape, parts renamed `Scrollbar`/`Thumb` ([base/ui/scroll-area.tsx][b-scroll]). |
| sheet | yes | Dialog primitive, `Backdrop` + `Popup`, `data-side` set by the wrapper ([base/ui/sheet.tsx][b-sheet] line 54). |
| slider, toggle-group, switch, checkbox, progress, avatar, separator | yes | Each imports its Base UI subpath. |
| button | yes | Real `@base-ui/react/button` primitive ([base/ui/button.tsx][b-button]). |
| badge, item, attachment, button-group | yes | `useRender` + `mergeProps` instead of `Slot`. |
| label | yes | Native `<label>`, no primitive ([base/ui/label.tsx][b-label]). |
| field, input-group, empty, kbd, spinner, input, textarea, skeleton, table, alert | yes | No Radix import today either; `skeleton` and `textarea` came back "identical" in the dry run. |

In Piano, 23 of the 35 import `radix-ui` (attachment, avatar, badge, button-group, button,
checkbox, collapsible, dialog, dropdown-menu, item, label, popover, progress, scroll-area, select,
separator, sheet, sidebar, slider, switch, toggle-group, toggle, tooltip); 12 do not (alert,
command, empty, field, input-group, input, kbd, skeleton, sonner, spinner, table, textarea)
(`grep -l 'from "radix-ui"' web/src/components/ui/*.tsx`). Outside `ui/`, only
[PianoSidebarReveal.tsx](../../web/src/components/PianoSidebarReveal.tsx) line 1 imports
`radix-ui`. The `"use client"` directives Piano preserves via `rsc: true` are still present in
base files ([base/ui/dialog.tsx][b-dialog] line 1), so that policy carries over unchanged.

## 2. API differences that reach Piano's wrappers

Each row names the Piano code that would change. Base UI facts come from the 1.9.0 source
checkout; shadcn facts from the base registry files and the migration skill's tables.

### 2.1 `asChild` → `render`

Base UI composes with a `render` prop ("Use the `render` prop to compose a Base UI part with
your own React components", [Composition handbook][bu-compose]); shadcn's rule adds
`nativeButton={false}` whenever `render` makes a trigger a non-button
([base-vs-radix.md][rule] lines 48-64). Piano has 41 `asChild` uses in 21 files outside `ui/`
(Sidebar.tsx 8, MobileSessionSheet.tsx 5, Composer.tsx 3, ShareSessionDialog.tsx 3, two each in
Changes, MessageList, NewSession, SessionHeader, SessionPullRequest, one each in Attachments,
Banner, EffortSelect, IconButton, JumpTo, ModelSelect, PianoSidebarMenuButton,
PianoSidebarReveal, ProviderLoginDialog, Quotes, RadiusSection, SlashTextarea) and 36 inside
`ui/` (`grep -c asChild`). The one in
[PianoSidebarMenuButton.tsx](../../web/src/components/PianoSidebarMenuButton.tsx) line 15
(`<TooltipTrigger asChild>{button}</TooltipTrigger>`) becomes
`<TooltipTrigger render={button} />`.

### 2.2 Portal / Positioner / Popup

Radix puts positioning props on `Content`; Base UI puts them on a `Positioner` between `Portal`
and `Popup` ("Base UI: `Portal > Positioner > Popup`", [universal-patterns.md][universal]
lines 94-100). The shadcn base wrappers forward exactly four Positioner props:
`Pick<…Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">`
([base/ui/popover.tsx][b-popover] lines 22-26, [dropdown-menu.tsx][b-dropdown] lines 28-32,
[tooltip.tsx][b-tooltip] lines 35-39; select adds `alignItemWithTrigger`,
[select.tsx][b-select] lines 75-79), and hard-code the Positioner's class (`isolate z-50`,
[b-popover] line 34; `isolate z-50 outline-none`, [b-dropdown] line 36). Anything else passed to
`…Content` lands on the Popup; the skill warns that forgotten positioner props "fall through
`...props` onto the Popup (wrong DOM node) and positioning silently breaks"
([universal-patterns.md][universal] lines 277-286). This touches Piano in three places:

- `collisionPadding={8}` in [PianoDropdownMenu.tsx](../../web/src/components/PianoDropdownMenu.tsx)
  lines 33 and 55, and `collisionPadding={16}` in JumpTo.tsx:67, ModelSelect.tsx:167,
  SessionHeader.tsx:144, SessionPullRequest.tsx:214. Base UI's Positioner default is 5
  (`collisionPadding = 5`, [TooltipPositioner.tsx][bu-tt-pos] line 36; Radix default 0 per
  [overlays.md][overlays] line 228), but the stock wrapper gives no way to pass Piano's values.
- `hideWhenDetached` in Quotes.tsx:159 is dropped; the replacement is CSS on the Positioner's
  `data-anchor-hidden` ([overlays.md][overlays] line 231).
- Piano's raised layer is `z-[60]` on the content ([overlayStyles.ts](../../web/src/lib/overlayStyles.ts)
  line 7, [PianoSelect.tsx](../../web/src/components/PianoSelect.tsx) line 18,
  [PianoTooltip.tsx](../../web/src/components/PianoTooltip.tsx) line 31) so it "sits above
  toasts". With the base wrappers the Popup is inside a Positioner that is `isolate z-50`, so a
  `z-[60]` on the Popup no longer competes with the toaster; the stacking value would have to move
  to the Positioner, which only the `ui/` file can style. This is the structural conflict with
  "There are no intentional patches left in `ui/`" ([shadcn-ui.md](../shadcn-ui.md)).

Popover `Anchor` is dropped as a part and becomes a Positioner `anchor` prop
([overlays.md][overlays] lines 197-202); Piano re-exports `PopoverAnchor`
([PianoPopover.tsx](../../web/src/components/PianoPopover.tsx) line 9) but no app file renders it
(`grep PopoverAnchor` outside `ui/` and the wrapper: none).

### 2.3 Data attributes and CSS variables

Base UI emits `data-open` / `data-closed` instead of `data-state="open|closed"`, plus
`data-starting-style` / `data-ending-style` for transitions ([Animation handbook][bu-anim]:
"`[data-starting-style]` corresponds to the initial style to transition from"; "`[data-open]`
corresponds to the style applied when a component becomes visible"). Submenu and menu triggers
get `data-popup-open` ([menus.md][menus] line 185; [popupStateMapping.ts][bu-psm] `TRIGGER_HOOK`),
collapsible triggers `data-panel-open` ([CollapsibleTriggerDataAttributes.ts][bu-coll-trig]),
toggles `data-pressed` ([class-mapping.md][classmap] line 15). `data-side` stays, on Positioner,
Popup and Arrow ([CommonPopupDataAttributes.ts][bu-cpda] line 32; [overlays.md][overlays]
line 261).

Piano's `index.css` imports `shadcn/tailwind.css` (line 23), whose `data-open:` and
`data-closed:` custom variants match **both** `[data-state="open"]` and `[data-open]`
([tailwind.css][sc-tw] lines 28-37). So the `data-open:`/`data-closed:` utilities in
[PianoSheet.tsx](../../web/src/components/PianoSheet.tsx) line 23 are already portable, while
every Tailwind arbitrary variant `data-[state=…]:` is Radix-only and stops matching silently:

| Site | Selector today | Base UI target |
| --- | --- | --- |
| [overlayStyles.ts](../../web/src/lib/overlayStyles.ts) line 7 | `data-[state=closed]:duration-…`, `data-[state=open]:zoom-in-…` | `data-closed:`, `data-open:` |
| [PianoDialog.tsx](../../web/src/components/PianoDialog.tsx) line 20 | same pattern | same |
| [PianoSheet.tsx](../../web/src/components/PianoSheet.tsx) line 30 | `data-[state=closed]:duration-200 … data-[state=open]:duration-300` | `data-closed:` / `data-open:` |
| [PianoTooltip.tsx](../../web/src/components/PianoTooltip.tsx) line 31 | `data-[state=closed]:zoom-out-[0.96]` | `data-closed:` |
| [PianoViewToggle.tsx](../../web/src/components/PianoViewToggle.tsx) line 18 | `data-[state=on]:…` (three) | `data-pressed:` |
| [lib/styles.ts](../../web/src/lib/styles.ts) line 5, [JumpTo.tsx](../../web/src/components/JumpTo.tsx) line 59, [Sidebar.tsx](../../web/src/components/Sidebar.tsx) line 66 | trigger `data-[state=open]:` | `data-popup-open:` |
| [RadiusSection.tsx](../../web/src/components/RadiusSection.tsx) line 121 | collapsible trigger `data-[state=open]:rounded-b-none` | `data-panel-open:` |
| [index.css](../../web/src/index.css) lines 361, 369, 373 | `[data-slot="dialog-overlay"][data-state="closed"]` etc. | `[data-closed]`, `[data-open]` on the Backdrop (slot name `dialog-overlay` is kept, [b-dialog] line 32) |
| [index.css](../../web/src/index.css) line 389 | `[data-slot="mobile-sidebar"][data-state="closed"]` | `[data-closed]` |
| [index.css](../../web/src/index.css) lines 745-749 | `.disclosure-content[data-state="open"|"closed"]` | `[data-open]` / `[data-closed]` |

CSS variables rename `--radix-<comp>-content-available-height` → `--available-height`,
`--radix-<comp>-trigger-width` → `--anchor-width`, `--radix-collapsible-content-height` →
`--collapsible-panel-height` ([class-mapping.md][classmap] lines 37-45; Base UI sets the latter in
[CollapsiblePanel.tsx][bu-coll-panel] line 112). Piano uses them in Composer.tsx:303,
JumpTo.tsx:74, Picker.tsx:24, SessionPullRequest.tsx:216, SlashTextarea.tsx:271 and 292,
[PianoDropdownMenu.tsx](../../web/src/components/PianoDropdownMenu.tsx) line 60, and
[index.css](../../web/src/index.css) lines 839 and 845.

`anchoredMotion` ([overlayStyles.ts](../../web/src/lib/overlayStyles.ts) line 3) neutralizes
upstream's per-side `slide-in-from-*` utilities. The base-vega dropdown and popover popups the
registry serves carry no per-side slide utilities (`cn-dropdown-menu-content … origin-(--transform-origin)`,
[b-dropdown] line 45); the served `base-vega` dialog does still use tw-animate keyframes
(`data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out …`, CLI
`--diff` output in §4), so Piano's zoom-in/out approach survives once the state variants are
renamed. Whether the served `base-vega` sheet keeps keyframes or uses the transition idiom in the
repo source (`data-ending-style:opacity-0 … translate-x-[2.5rem]`, [b-sheet] line 56) was not
checked; `PianoSheet`'s `slide-in-from-left-full` keyframe utilities only work in the first case.
Verify with `--diff` at migration time.

### 2.4 Event hooks: the per-interaction callbacks become `initialFocus`, `finalFocus` and `onOpenChange` reasons

Radix's `onOpenAutoFocus`, `onCloseAutoFocus`, `onEscapeKeyDown`, `onPointerDownOutside` and
`onInteractOutside` "have NO 1:1 Base UI props. They are replaced by `onOpenChange`'s
`eventDetails.reason` (`'escape-key'`, `'outside-press'`, `'focus-out'`) + `eventDetails.cancel()`"
and by Popup `initialFocus` / `finalFocus` ([overlays.md][overlays] lines 11, 57-61). In source:
`DialogPopup` destructures `finalFocus, initialFocus` and passes `returnFocus={finalFocus}`
([DialogPopup.tsx][bu-dialog-popup] lines 26, 103-104); the reason union is `triggerPress |
outsidePress | escapeKey | closePress | focusOut | imperativeAction | none`
([DialogRoot.tsx][bu-dialog-root] lines 99-105); `modal` widens to `boolean | 'trap-focus'`
(line 46). `finalFocus` accepts `(closeType: 'mouse' | 'touch' | 'pen' | 'keyboard') => boolean |
void | HTMLElement | null` and "Return `false` to replicate `event.preventDefault()`"
([menus.md][menus] line 53).

That last signature is exactly the policy [pointerClose.ts](../../web/src/lib/pointerClose.ts)
reconstructs with document-level `pointerdown`/`keydown` listeners (lines 1-17): "Return it only
when the keyboard closed the overlay; a click leaves focus alone" (line 21). On Base UI it is
`finalFocus={(type) => type === "keyboard"}` with no global state. Call sites to rewrite:

| Radix prop | Piano sites |
| --- | --- |
| `onCloseAutoFocus` | PianoPopover.tsx:25, PianoDropdownMenu.tsx:41, PianoSidebarReveal.tsx:61, MobileSessionSheet.tsx:121, ModelSelect.tsx:197, SessionPullRequest.tsx:197 and 211, Quotes.tsx:163, SlashTextarea.tsx:273 |
| `onOpenAutoFocus` | CommandHost.tsx:213, PianoSidebarReveal.tsx:57, Picker.tsx:27, Projects.tsx:180, Quotes.tsx:162, SlashTextarea.tsx:272 |
| `onInteractOutside` | ProviderLoginDialog.tsx:83, ProviderSignOutDialog.tsx:34, RemovalDialog.tsx:47, SlashTextarea.tsx:277 (the three dialogs can use Root `disablePointerDismissal`, [overlays.md][overlays] line 60) |
| `onEscapeKeyDown` | ModelSelect.tsx:190, SlashTextarea.tsx:274, Worktrees.tsx:99 |

### 2.5 Menu items, submenus, modality

Menu items use `onClick` plus `closeOnClick` (default `true` on `Item`,
[MenuItem.tsx][bu-menu-item] line 117) instead of `onSelect`; `closeOnClick` defaults to `false`
on `CheckboxItem` and `RadioItem`, a flagged behaviour delta ([consumer-props.md][consumer]
line 37). Piano's `DropdownMenuItem onSelect` sites: NewSession.tsx:270, 389, 404, 415;
Projects.tsx:79, 88, 145; Sidebar.tsx:543, 615; SessionHeader.tsx:154. Composer.tsx:218-231 uses
`DropdownMenuRadioGroup`/`RadioItem`, so the queue-mode menu would stay open after a pick unless
`closeOnClick` is set. `onSelect` on `CommandItem` (CommandHost.tsx:126, CommandPalette.tsx:108,
133, 145) is cmdk's and does not change. `Menu.Root` keeps `modal` (default `true`,
[MenuRoot.tsx][bu-menu-root] line 842), so SessionHeader.tsx:140 `modal={false}` carries over.
Submenus are `SubmenuRoot`/`SubmenuTrigger`, and the base `DropdownMenuSubContent` composes
`DropdownMenuContent` with `align="start" alignOffset={-3} side="right" sideOffset={0}`
([b-dropdown] lines 134-156); Piano's `DropdownMenuSubContent` wrapper
([PianoDropdownMenu.tsx](../../web/src/components/PianoDropdownMenu.tsx) lines 49-65) would lose
its `--radix-…-available-height` class for `max-h-(--available-height)`.

### 2.6 Tooltip

Provider `delayDuration` becomes `delay` ([consumer-props.md][consumer] line 22); Piano sets
`delayDuration={300}` in main.tsx:21 and AppLayout.tsx:60, and the shadcn radix wrapper defaults
it to 0 ([ui/tooltip.tsx](../../web/src/components/ui/tooltip.tsx) line 8) as the base one defaults
`delay = 0` ([b-tooltip] line 7). Base UI's trigger `delay` falls back to the provider's
(`delay ?? providerDelay ?? OPEN_DELAY`, [TooltipTrigger.tsx][bu-tt-trig] line 118).

Opening on focus differs. Radix opens on any focus not preceded by a pointerdown on the trigger
(`if (!isPointerDownRef.current) context.onOpen()`, installed
`@radix-ui/react-tooltip/dist/index.mjs` lines 209-211), which is why
[PianoTooltip.tsx](../../web/src/components/PianoTooltip.tsx) lines 12-21 wraps `onFocus` with
`preventPointerFocus`. Base UI's trigger uses the vendored `useFocus`, which returns early when
`!matchesFocusVisible(target)` ([useFocus.ts][bu-usefocus] line 146), so a tooltip opens on focus
only when the browser would draw a focus ring. The `TooltipTrigger` wrapper likely becomes
unnecessary (inferred from source; confirm by observation). `PianoSidebarMenuButton` passes
`hidden={…}` to `TooltipContent` (line 19); whether Base UI's Popup forwards a `hidden`
attribute as the Radix content did is unverified.

### 2.7 Select

`position="popper" | "item-aligned"` becomes `alignItemWithTrigger` on the Positioner, default
`true` ("Whether the positioner overlaps the trigger so the selected item's text is aligned with
the trigger's value text. This only applies to mouse input", [SelectPositioner.tsx][bu-sel-pos]
lines 256-260); Piano's radix wrapper defaults `position = "item-aligned"`
([ui/select.tsx](../../web/src/components/ui/select.tsx) line 62), so the default behaviour
matches. shadcn's rule says the base Select "requires an `items` prop on the root" with a
`{ value: null }` item as the placeholder instead of `<SelectValue placeholder>`
([base-vs-radix.md][rule] lines 85-136); `Select.Root` declares `items?:` optional in source
([SelectRoot.tsx][bu-sel-root] line 698), so "required" is a registry convention rather than a type
requirement. `onValueChange` widens to `(value: Value | null, eventDetails)`
([consumer-props.md][consumer] line 29). Piano's only Select consumer is
ProviderLoginDialog.tsx:202-204 (`onValueChange={setValue}`, `<SelectValue placeholder=…>`).
`PianoSelect` itself only adds `z-[60]` (line 18), which §2.2 explains no longer reaches the
stacking node.

### 2.8 Dialog and Sheet

Overlay → `Backdrop`, Content → `Popup`, centered modals have no Positioner, `showCloseButton`
survives ([b-dialog] lines 26-83). The base Backdrop keeps `data-slot="dialog-overlay"` /
`"sheet-overlay"`, so the backdrop exception in [index.css](../../web/src/index.css) lines
348-376 keeps its hook and only changes its state selectors. Base UI holds the popup mounted
through exit animations on its own ("Base UI detects animations on the popup element. CSS
animations are always detected", [Animation handbook][bu-anim]), which is what Radix Presence
did for `[data-slot="mobile-sidebar"][data-state="closed"]` (index.css line 389-392).

### 2.9 ScrollArea: the `display: table` rule goes away

Radix's implicit content element sets `style: { minWidth: "100%", display: "table" }` with the
comment "`display: table` ensures our content div will match the size of its children"
(installed `@radix-ui/react-scroll-area@1.4.0`, `dist/index.mjs` lines 199-210; `radix-ui@1.8.1`
depends on that version). Radix 1.4.0 adds `disableImplicitContentElement` and a
`ScrollArea.Content` part, noting "Implicit rendering of the content element will be removed in
the next major release" (`dist/index.d.ts` lines 68-71), but shadcn's radix wrapper does not use
them ([ui/scroll-area.tsx](../../web/src/components/ui/scroll-area.tsx) lines 18-23), so the
override in [index.css](../../web/src/index.css) lines 461-466 stays necessary on Radix. Base UI's
Viewport renders no implicit wrapper; its optional `Content` part uses `minWidth: 'fit-content'`
([ScrollAreaContent.tsx][bu-sa-content] lines 67-68), and shadcn's base wrapper renders children
directly inside the Viewport ([b-scroll] lines 18-23). The rule and its `!important` disappear.

### 2.10 Collapsible, ToggleGroup, Slider, form controls

Collapsible: Content → `Panel` ([base/ui/collapsible.tsx][b-coll] line 15), var and state
attributes per §2.3; Piano's `.disclosure-content` sites are Banner.tsx:21, Changes.tsx:157 and
382, MessageList.tsx:335 and 395, RadiusSection.tsx:136, Sidebar.tsx:187, 552 and 631.
ToggleGroup: `type="single" | "multiple"` is dropped, `value`/`defaultValue` are always arrays,
`multiple` is a boolean ([base-vs-radix.md][rule] lines 180-234); Piano sets `type="single"` in
EffortSelect.tsx:27, ContextDetails.tsx:80 and WorkspaceFile.tsx:181, and
`onValueChange={(value) => value && setMode(value)}` at WorkspaceFile.tsx:183 would receive an
array. Slider: Base accepts a plain number for one thumb and `onValueChange` gains event details;
"Controlled `onValueChange` in base may need a cast" ([rule] lines 238-270); Piano's single
slider is ContextDetails.tsx:143-149 (`value={[position]}`, `([value]) => …`). Checkbox
(Worktrees.tsx:144) and Switch (MobileSessionSheet.tsx:160) are "1:1"; Progress
(ContextDetails.tsx:66) and Avatar (SessionPullRequest.tsx:265) change only inside `ui/`
([universal-patterns.md][universal] lines 200-212).

### 2.11 PianoSidebarReveal

This is the one Piano file that composes Radix directly: `Dialog.Portal`, `Dialog.Content` and
`Dialog.Close asChild` ([PianoSidebarReveal.tsx](../../web/src/components/PianoSidebarReveal.tsx)
lines 1, 50-51, 70) with `onOpenAutoFocus`/`onCloseAutoFocus` (lines 57-65). On Base UI it
becomes `Dialog.Portal > Dialog.Popup` with `initialFocus={() => !dragging && content.current}`
style logic and `finalFocus={() => { restoreFocus(); return false }}` (shape per §2.4), and
`Dialog.Close render={<button … />}`. Its exit hold moves from `[data-state="closed"]` to
`[data-closed]`. `useSidebarSwipe` and `useSidebarLayout` have no Radix coupling (`grep
'radix|data-state|Dialog|Presence'` on both: none), and the scrim selector it matches,
`[data-slot="sidebar-scrim"]` (useSidebarSwipe.ts:108), is Piano's own attribute.

### 2.12 Browser evidence scripts

`[data-radix-popper-content-wrapper]` is Radix's positioning wrapper
(`@radix-ui/react-popper/dist/index.mjs` line 214) and is waited on in
[harness.mjs](../../test/browser/harness.mjs) line 169, start-session.mjs:21, open-session.mjs:98,
style-shots.mjs:154 and 161. Base UI has no equivalent and shadcn's base Positioner carries no
`data-slot` ("Positioner parts get NO `data-slot` attribute", [wrapper-shapes.md][shapes]
lines 10-11); the waits would target `[data-slot="select-content"]` /
`[data-slot="popover-content"]` presence instead. style-shots.mjs:164's `[role=menu]` wait is
base-agnostic. Radix menus being driven with pointer events (AGENTS.md) applies to Base UI menus
as well: hover and press reasons are first-class (`'trigger-hover' | 'trigger-press'`,
[menus.md][menus] line 30).

## 3. Gaps and caveats

- **Stability.** Base UI 1.0.0 shipped 2025-12-11 and 1.9.0 on 2026-10-09
  ([CHANGELOG.md][bu-cl] lines 1-6 and 1459-1461). Peers: `react` and `react-dom`
  `^17 || ^18 || ^19` (`npm view @base-ui/react peerDependencies`), matching "Base UI supports
  React 17 and newer versions" ([About][bu-about]); Piano is on React 19.3.0. Browser policy is
  "features marked as Baseline Widely Available at the time of the last major version release",
  i.e. "supported across major browsers for at least 30 months" ([About][bu-about]); Piano's
  phone layouts should be checked on an actual Safari once, as [shadcn-ui.md](../shadcn-ui.md)
  already requires. 277 source files carry `'use client'`
  (`grep -rl "'use client'" packages/react/src`), so the directive policy is unchanged. Nothing in
  the base registry is marked experimental; `drawer` moved from vaul to `@base-ui/react/drawer`
  but Piano does not install it.
- **Base UI has no Radix migration guide of its own.** The docs tree has `overview`, `handbook`
  (`animation`, `composition`, `customization`, `forms`, `styling`, `typescript`) and `utils`;
  `grep -rli radix docs/src/app/(docs)` matches only keyword metadata such as "Radix Alternative"
  ([About][bu-about] line 74). shadcn's skill tables are the only structured mapping, dated
  2026-07-02 against 1.6.0 ([universal-patterns.md][universal] lines 3-7).
- **Version drift between what shadcn verified (1.6.0) and what npm installs (1.9.0)** is
  unpinned by the registry (§1). Pin an exact version in `web/package.json` and record it.
- **Silent class breakage.** Every `data-[state=…]:` arbitrary variant keeps compiling and
  simply stops matching (§2.3). Only the before/after screenshots in `style-shots.mjs` and the
  journeys catch these.
- **Behaviour deltas the skill flags rather than patches:** checkbox/radio menu items do not
  close on click by default; `collisionPadding` default 0 → 5; Select overlaps the trigger by
  default; tooltip `skipDelayDuration` has no equivalent ([consumer-props.md][consumer] lines
  22-23, 37; [overlays.md][overlays] line 228). shadcn's own measured run: "60+ components, 36 of
  them on Radix. A full migration ran in about 25 minutes at roughly 10k tokens per component"
  ([July 2026 changelog][cl-default]), with the caveat that their report format exists because
  deltas need hand verification.
- **Radix is maintained.** `radix-ui@1.8.1` metadata was modified 2026-10-14 and a `1.8.2-rc`
  tag exists (`npm view radix-ui dist-tags time.modified`); shadcn "will ship for both libraries
  (unless a component only exists in Base UI)" ([July 2026 changelog][cl-default]).

## 4. Effort and plan

Verified dry run (scratch copy of `web/` with `"style": "base-vega"`, `node_modules` symlinked,
`npx shadcn@latest add dialog sheet popover tooltip dropdown-menu select scroll-area collapsible
toggle-group button badge sidebar command --dry-run --overwrite`): "Files (20) ~18 overwrite,
=2 skip" (skeleton and textarea identical; input, separator, toggle, input-group and
`hooks/use-mobile.ts` pulled in transitively), "Dependencies (2) + cn + cmdk", no
`@base-ui/react`. The `--diff` for `dialog.tsx` is a clean swap: import, `Overlay` → `Backdrop`,
`Content` → `Popup`, `React.ComponentProps<typeof …>` → `DialogPrimitive.Part.Props`, and the two
`asChild` closes → `render`, with class strings unchanged apart from state variants already in the
`data-open:` form. Because `ui/` has no local patches ([shadcn-ui.md](../shadcn-ui.md)), the
`ui/` half of the migration is overwrite-only; the cost is in the wrappers, 30-odd consumer
files, CSS and evidence.

Steps:

1. Baseline on a clean tree: `npm run typecheck`, `npm test`, `npm run test:browser`,
   `node test/browser/style-shots.mjs <before>` and `node test/browser/transcript-rows.mjs`.
2. `npm install --save-exact @base-ui/react@<pinned>` in `web/`; keep `radix-ui` until step 8.
3. Set `"style": "base-vega"` in `web/components.json`.
4. Re-add every `ui/` file leaf-first (`button label separator input textarea skeleton toggle
   input-group tooltip dialog sheet popover dropdown-menu select scroll-area collapsible
   toggle-group badge item attachment button-group avatar checkbox switch slider progress
   sidebar command field empty kbd spinner alert table sonner`), each as
   `npx shadcn@latest add <name> --dry-run --diff <file>` then `--overwrite`; never
   `--all --overwrite` ([SKILL.md][skill] line 46). Finish with `grep -rn "radix-ui" web/src`.
5. Rewrite the wrappers and shared libs (risk below).
6. `index.css`: state selectors at lines 361, 369, 373, 389, 745, 748; var rename at 839 and
   845; delete 461-466.
7. Consumer sweep per §2: `asChild` (41 sites), `onSelect` on menu items (10 sites),
   focus/dismiss hooks (22 sites), `--radix-*` vars (7 sites), `data-[state=…]` class strings
   (9 sites outside the wrappers), ToggleGroup `type`/array values (3 sites), Slider, Select,
   TooltipProvider `delay` (2 sites), `DropdownMenuRadioItem closeOnClick`.
8. Browser scripts: replace the five popper-wrapper waits; run `npm run test:browser`,
   `transcript-rows.mjs`, and `style-shots.mjs <after>`; compare pairs; then drive the phone
   sidebar reveal, swipe cancellation, Mod+K, menus by pointer and keyboard, tooltip focus, and
   reduced motion through `agent-browser` on a scratch instance.
9. Remove `radix-ui` from `web/package.json`; rerun the gates; rewrite the Radix-specific
   paragraphs of `docs/shadcn-ui.md` (ScrollArea exception, pointer-close rationale, "composes
   the same Radix modal primitive").

Risk per Piano-owned file:

| File | Change | Risk |
| --- | --- | --- |
| PianoButton, StatusBadge, PianoAlert | none beyond `variant={null}` on the new primitives | Low |
| PianoCommand, PianoSidebarMenuButton | cmdk unchanged; `asChild` → `render` once | Low |
| PianoViewToggle | `data-[state=on]` → `data-pressed`; three consumers drop `type`, use arrays | Medium |
| PianoDialog | state variants; six consumers move `onInteractOutside`/`onOpenAutoFocus` to Root/Popup props | Medium |
| PianoSheet | motion rewrite hinges on the served sheet's idiom (§2.3); MobileSessionSheet `finalFocus` | Medium |
| PianoTooltip | `delay`; focus guard likely removable; `z-[60]` and `hidden` need checking | Medium |
| PianoSelect | `z-[60]` unreachable; one consumer's placeholder/value shape | Medium |
| PianoPopover | `collisionPadding`, `hideWhenDetached`, `z-[60]` all need the Positioner (§2.2); eight consumers with vars and focus hooks | High |
| PianoDropdownMenu | same Positioner problem; `onSelect` → `onClick` at ten sites; sub-content var; radio `closeOnClick` | High |
| PianoSidebarReveal | hand-composed primitives, focus hooks, exit-hold CSS, scrim; phone-only verification | High |
| lib/overlayStyles.ts | state variants and the slide-neutralizing rationale | Medium |
| lib/pointerClose.ts | shrinks to the tooltip guard or is deleted | Low |
| index.css | ten selector/var edits, one deletion | Medium |
| test/browser (4 files) | five waits | Low |

Effort (inferred, not measured): two to four focused days including the browser evidence, most
of it in the three High rows and in deciding how Piano reaches the Positioner.

## 5. Recommendation

Defer. Judged by the cost the code pays now:

- The Radix-specific costs present today are the `display: block !important` ScrollArea override
  (index.css:461-466), the document-level listeners in `pointerClose.ts` that approximate the
  interaction type Base UI's `finalFocus` passes natively, five Radix-internal selectors in the
  browser scripts, and seven `--radix-*` variable names. None is a reachable bug, none is a
  decision made twice, and no recent `feat`/`fix` commit touched several modules for a Radix
  concept (the last five commits are sheet motion, menu layout and sidebar width changes made
  entirely inside the wrappers and CSS).
- The move adds a cost the code does not pay today: Piano's overlay policy (raised `z-[60]`
  layer, `collisionPadding` 8/16, `hideWhenDetached`) lives on Radix `Content`, which is the
  outermost positioned node; on Base UI it belongs on the `Positioner`, which the stock base
  wrappers neither expose nor let the caller style (§2.2). The honest options are a patch in
  `ui/` (which [shadcn-ui.md](../shadcn-ui.md) forbids and every upgrade would re-merge) or
  rebuilding `PopoverContent`, `DropdownMenuContent`, `TooltipContent` and `SelectContent` from
  primitives inside the `Piano*` wrappers, which makes Piano own more overlay code than it does
  now.
- shadcn commits to shipping both bases and itself is "not migrating"; Radix is being published.

Revisit when one of these holds: shadcn ships a Base-only component Piano wants; the base
wrappers start forwarding Positioner props (a `className`/`collisionPadding` on `…Content`
would remove the High rows' main difficulty); `radix-ui` stops receiving releases; or Radix's
next major removes the implicit ScrollArea content element and shadcn's radix wrapper changes
shape anyway. Cheap, base-neutral preparation that is worth doing on Radix regardless: move the
wrappers' class strings from `data-[state=open|closed]:` to the `data-open:`/`data-closed:`
variants that `shadcn/tailwind.css` already matches on both libraries (§2.3), and change the
browser scripts' waits from `[data-radix-popper-content-wrapper]` to `data-slot` presence.

## Verification

Read-only research. Commands run: `npx shadcn@latest info` and `add --help` in `web/`; the
dry run and `--diff` above in a scratch copy under the session scratchpad (`web-base/`, with
`node_modules` symlinked to the repo's and the style edited there only); `curl` of
`https://ui.shadcn.com/r/styles/base-vega/{index,style,dialog,sheet,sidebar,command,sonner,scroll-area,tooltip,select,dropdown-menu,popover,collapsible,toggle-group,button}.json`
and `radix-vega/dialog.json`; `npm view` for `@base-ui/react`, `@base-ui-components/react`,
`radix-ui` and `shadcn`; `git clone --depth 1` of the two upstream repos; `grep`/`diff` over
Piano, the installed `node_modules/@radix-ui/*` packages and both checkouts. No file under
`web/src`, `web/components.json` or `package.json` was changed, nothing was installed into the
repository, and no app run or browser journey was performed: the API facts are from source and
docs, not observed behaviour.

[bases]: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases.ts
[preset]: https://github.com/shadcn-ui/ui/blob/main/packages/registry/src/preset/preset.ts
[cl-default]: https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default
[cl-radix]: https://ui.shadcn.com/docs/changelog/2026-02-radix-ui
[cl-apply]: https://ui.shadcn.com/docs/changelog/2026-04-shadcn-apply
[cj-docs]: https://ui.shadcn.com/docs/components-json
[migrate]: https://github.com/shadcn-ui/ui/blob/main/packages/shadcn/src/commands/migrate.ts
[skill]: https://github.com/shadcn-ui/ui/blob/main/skills/migrate-radix-to-base/SKILL.md
[skill-dir]: https://github.com/shadcn-ui/ui/tree/main/skills/migrate-radix-to-base
[universal]: https://github.com/shadcn-ui/ui/blob/main/skills/migrate-radix-to-base/universal-patterns.md
[overlays]: https://github.com/shadcn-ui/ui/blob/main/skills/migrate-radix-to-base/overlays.md
[menus]: https://github.com/shadcn-ui/ui/blob/main/skills/migrate-radix-to-base/menus.md
[consumer]: https://github.com/shadcn-ui/ui/blob/main/skills/migrate-radix-to-base/consumer-props.md
[classmap]: https://github.com/shadcn-ui/ui/blob/main/skills/migrate-radix-to-base/class-mapping.md
[shapes]: https://github.com/shadcn-ui/ui/blob/main/skills/migrate-radix-to-base/wrapper-shapes.md
[rule]: https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/rules/base-vs-radix.md
[sc-tw]: https://github.com/shadcn-ui/ui/blob/main/packages/shadcn/src/tailwind.css
[v4-pkg]: https://github.com/shadcn-ui/ui/blob/main/apps/v4/package.json
[style-json]: https://ui.shadcn.com/r/styles/base-vega/style.json
[base-ui-dir]: https://github.com/shadcn-ui/ui/tree/main/apps/v4/registry/bases/base/ui
[b-dialog]: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/dialog.tsx
[b-sheet]: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/sheet.tsx
[b-popover]: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/popover.tsx
[b-dropdown]: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/dropdown-menu.tsx
[b-tooltip]: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/tooltip.tsx
[b-select]: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/select.tsx
[b-scroll]: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/scroll-area.tsx
[b-coll]: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/collapsible.tsx
[b-sidebar]: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/sidebar.tsx
[b-button]: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/button.tsx
[b-label]: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/label.tsx
[bu-cl]: https://github.com/mui/base-ui/blob/master/CHANGELOG.md
[bu-about]: https://base-ui.com/react/overview/about
[bu-anim]: https://base-ui.com/react/handbook/animation
[bu-compose]: https://base-ui.com/react/handbook/composition
[bu-dialog-popup]: https://github.com/mui/base-ui/blob/master/packages/react/src/dialog/popup/DialogPopup.tsx
[bu-dialog-root]: https://github.com/mui/base-ui/blob/master/packages/react/src/dialog/root/DialogRoot.tsx
[bu-menu-item]: https://github.com/mui/base-ui/blob/master/packages/react/src/menu/item/MenuItem.tsx
[bu-menu-root]: https://github.com/mui/base-ui/blob/master/packages/react/src/menu/root/MenuRoot.tsx
[bu-sel-pos]: https://github.com/mui/base-ui/blob/master/packages/react/src/select/positioner/SelectPositioner.tsx
[bu-sel-root]: https://github.com/mui/base-ui/blob/master/packages/react/src/select/root/SelectRoot.tsx
[bu-tt-pos]: https://github.com/mui/base-ui/blob/master/packages/react/src/tooltip/positioner/TooltipPositioner.tsx
[bu-tt-trig]: https://github.com/mui/base-ui/blob/master/packages/react/src/tooltip/trigger/TooltipTrigger.tsx
[bu-usefocus]: https://github.com/mui/base-ui/blob/master/packages/react/src/floating-ui-react/hooks/useFocus.ts
[bu-psm]: https://github.com/mui/base-ui/blob/master/packages/react/src/utils/popupStateMapping.ts
[bu-cpda]: https://github.com/mui/base-ui/blob/master/packages/react/src/utils/CommonPopupDataAttributes.ts
[bu-coll-trig]: https://github.com/mui/base-ui/blob/master/packages/react/src/collapsible/trigger/CollapsibleTriggerDataAttributes.ts
[bu-coll-panel]: https://github.com/mui/base-ui/blob/master/packages/react/src/collapsible/panel/CollapsiblePanel.tsx
[bu-sa-content]: https://github.com/mui/base-ui/blob/master/packages/react/src/scroll-area/content/ScrollAreaContent.tsx
