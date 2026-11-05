# Responsive layout ownership and implementation plan (#557)

- **Date:** 2026-11-05. **Status:** research/proposal, not a behavior change or a new accepted UI contract.
- **Request:** [issue #557](https://github.com/goofansu/piano/issues/557), including intermediate widths, sidebar states and wide touch devices.
- **Inspected revision:** [`4f2babc19b2bee94f1043d3b01255249b46a9620`](https://github.com/goofansu/piano/commit/4f2babc19b2bee94f1043d3b01255249b46a9620), clean application sources in the dedicated `research/557-responsive-layout` worktree. All source links below are pinned to that revision unless stated otherwise.
- **Important baseline distinction:** this checkout predates [PR #555](https://github.com/goofansu/piano/pull/555). GitHub's [comparison to its merge](https://github.com/goofansu/piano/compare/4f2babc19b2bee94f1043d3b01255249b46a9620...32b9ab42688b4c058f979866fd2e742715f5bd54) is five commits ahead. Its [final header](https://github.com/goofansu/piano/blob/32b9ab42688b4c058f979866fd2e742715f5bd54/web/src/components/SessionHeader.tsx#L90-L111) changes only the context label to `context.folderName` and its comment. Do not rediscover the older checkout's repository label as an unfixed #557 bug. The plan assumes #555 is retained.

## Recommendation

Keep three independent signals: **session capacity**, **viewport presentation**, and **input capability**. Consolidate owners and names, not all thresholds. Preserve the existing header's mixed presentation until a specific change is approved. No evidence here justifies replacing 849 with 768, treating a coarse pointer as a phone, changing the rail threshold, or redesigning the shell.

The strongest findings are source-proven vocabulary drift, duplicated viewport definitions, and missing coverage of **measurement → navigation → rendering** at the exact boundaries. Most different-looking rules are intentional or require a decision, not proven rendering defects. Existing navigation tests already protect much of the state policy; extend at the missing boundary rather than duplicating them.

This follows the [ADR's existing ownership](../adr/0001-pi-rpc-workspace-workbench.md), the [roadmap's daily-use priority](../roadmap.md#current-priority-joyful-daily-use), [testing policy](../testing.md), [Quiet UI](../quiet-ui.md), and [shadcn ownership](../shadcn-ui.md). Relevant invariant IDs below refer to [development invariants](../development-invariants.md), not a claim that this research implements them.

## Proposed vocabulary (for a later glossary change)

The current [glossary](../glossary.md) names the Agent area, Surface area and session rail but not the two layouts. Proposed entries contain domain meaning, not pixel constants:

| Term | Proposed meaning |
| --- | --- |
| **One-area-at-a-time** | The session layout in which either the Agent area or the Surface area is shown. When inspection tabs exist, Agent and those tabs share navigation; otherwise Agent needs no tab. The session rail is unavailable in this layout. |
| **Side-by-side** | The session layout in which the Agent area remains shown and the right side can show the Surface area or session rail. It does not require an inspection view to be open, and does not mean three simultaneous columns. |

Use **narrow/wide viewport** only for viewport-dependent presentation, **available session width** for measured space after navigation and framing, and **coarse pointer** for the actual input query. These are technical qualifiers, not new labels to display. A wide viewport can be one-area-at-a-time; either layout can have a coarse pointer. Replace the glossary's parenthetical “phones” with “one-area-at-a-time” when adopting these definitions. Keep “Agent” as a tab name and name the inspection view in the UI, never add a “Surface” title.

The existing `single` boolean means one-area-at-a-time; `false` means side-by-side capacity, **not** “Surface visible.” Keep this internal boolean unless a focused rename pays for itself; do not store a second enum representing the same state. [Derivation: navigation.ts:59–104][navigation].

## Decision map: current behavior and owner

“Current” below means source-derived behavior, including #555's label-only delta. It is not a fresh browser observation.

| Surface / decision | Signal and current rule | Ownership / rationale to preserve |
| --- | --- | --- |
| Session capacity | `A > 0 && A < 849` → one area; `A >= 849` → side-by-side. `849 = 448` Agent minimum + `400` Surface minimum + `1` hairline. Zero/unmeasured yields no update. | [panelLayout.ts:8–22][geometry] owns geometry; [SessionView.tsx:73–92][measurement] observes the **areas container**, not the viewport, and reports to navigation. Hidden under Settings, preserve the previous layout. |
| Visible areas and rail | One-area: last selected area, no rail; Agent tab only when Surface tabs exist. Side-by-side: Agent always; Surface or rail on the right, whichever was brought in last. | [navigation.ts:59–104][navigation] is the one state projection. [setSingle/toggleRail/open/close:701–745][moves] preserve tabs, return destinations and the remembered rail choice. No media query in command policy. |
| Agent area | Hidden in place with `inert`/`aria-hidden`, not unmounted. Side-by-side sets Agent's minimum; rail reserves 320px through `--rail-inset` for transcript/composer/status content. “Ask” returns to Agent only one-area-at-a-time. | [SessionView.tsx:89–113][measurement], [145–288][agent]. Keep draft, reading position and session identity through layout changes (INV-02, INV-07). |
| Surface area | Full session width one-area-at-a-time; otherwise remembered 400–1024px, default 480, constrained to leave Agent room. Splitter only when visible side-by-side. Hidden views stay mounted/inert. | [SurfaceArea.tsx:99–214][surface], [SessionPanel.tsx:84–266][panel]. A preferred Surface width is not another layout threshold. |
| Tabs, close and focus | One-area uses the shared Agent + inspection strip; side-by-side uses a Surface-only strip with close buttons. One-area close joins the view toolbar; Escape closes a Surface tab only side-by-side. Closing falls back to the active tab/menu or rail/Changes controls, not composer. | [SessionView.tsx:293–342][areaTabs], [SessionPanel.tsx:98–158][panel], [SurfaceArea.tsx:34–94][surface]. Strip overflow is local horizontal scrolling, not a breakpoint. |
| Rail and commands | Rail available only side-by-side, even with no Surface open; narrower rail does **not** get its own lower threshold. Rail command hidden/disabled one-area-at-a-time; Agent command available with shared tabs. | [sessionCommands.ts:379–397][commands], [SessionRail.tsx:51–130][rail]. Rail preference `piano.details` survives layout changes ([useNavigation.ts:12–35][hookNav]). Rail overflow/fading/wheel routing depend on its content height, not phone detection. |
| Shell / sidebar | At viewport 768px and up, collapsible/resizable column: 208–480px, default 288; drag release below 160 collapses but remembers prior width. Below boundary, modal reveal; main remains full-width and translates by up to 75vw. | [sidebarLayout.ts:1–243][sidebar], [AppLayout.tsx:28–139][shell], [useSidebarSwipe.ts:12–231][swipe], [reveal CSS:374–453][cssReveal]. Sidebar state does not choose the session layout directly; its geometry changes A. |
| Sidebar commands / focus | Show/hide/toggle dispatch by viewport. Crossing the breakpoint closes the reveal and cancels resize. Show control is visible below md or when collapsed. Navigation moves close the reveal. | [sidebarLayout.ts:128–224][sidebar], [ShowSidebarButton.tsx:11–46][showSidebar], [App.tsx:58–100][app]. Swipe accepts touch events only below shell breakpoint, excludes 24px edges, controls, horizontal scrollers and text selection; it cancels on resize/blur. |
| Header context and menu kind | `sheet = mobile || single`. With a loaded session, the sheet presentation adds folder + branch/short detached commit under title. Otherwise no second line. Sheet includes management, project picker, display switch, destructive actions, linked PR and Preview; omits rail Outputs, environment copy menus and session ID. | [SessionHeader.tsx:56–119][header], [MobileSessionSheet.tsx:161–305][sheet], [sessionPlace:311–340][context], #555 above. Keep the small-viewport fallback until initial measurement/hidden-view behavior is verified. |
| Header menu position and project crumb | `mobile` alone puts menu at header end; otherwise beside title. Project crumb and separator are CSS md-only, when there is a project. Thus a **wide one-area session has a sheet beside its title AND a project crumb**. Header title control height grows on coarse pointer, independent of both rules. | [SessionHeader.tsx:180–235][header]. This is the critical mixed case, not evidence of a wrong condition. Sheet closes when switching to dropdown and does not reopen automatically on narrowing. |
| Sidebar density and row actions | Rows declare 32px / coarse 44px / max-md 48px; detailed rows 44 / 56 / 60. Gap 4px below md, 2px above. Session-row menus are hidden below md even with a fine pointer; wide coarse row actions stay in flow and visible. | [SidebarSessionList.tsx:25–190][rows], [RowActions.tsx:4–33][rowActions], [index.css:878–933][cssRows]. Virtualization measures the rendered row and gap ([useSidebarWindow.ts:6–73][window]), so do not duplicate these sizes in JS. Values here describe declarations; verify cascade where coarse and max-md overlap. |
| Shared controls | Header/list icon actions 32→44px on coarse pointer; row icons 24→36; inline icons stay 24. Menu/select/command/toggle items have coarse minimum 44px. Strip tabs and bars grow on coarse pointer; palette rows stay 48px for both. | [PianoButton.tsx:12–30][button], [index.css:350–362][cssTouch], [PianoTabs.tsx:78–143][strip], [PianoCommand.tsx:24–88][commandSize]. Follow Quiet UI's place-based sizes and explicit exceptions; no universal “all buttons 44px” rewrite. |

### Remaining responsive consumers (not additional session modes)

This completes the search of application width/input conditions and distinguishes local fitting and upstream rules from mode selection. Repeated utility classes do not automatically need a JS abstraction.

| Condition | Consumers and observable effect |
| --- | --- |
| md / 48rem global density | [Root frame tokens:82–99][tokens]; [index.css:223–242][typography] increases gutter 16→24px and decreases label/caption 16/14→14/12px. [Session-sidebar CSS:484–491][cssSidebar] uses 17/15px below md, excluding portaled menus. [Pane header:17–40][pane] remains 48px high. |
| md spacing, not area choice | [Composer:128,171,285][composer] changes alert margins, queue Edit height and usage gaps; [Banner:39][banner] margins; [MessageList:202][messagePadding] and [skeleton:422][skeleton] vertical padding; [WorkspaceFile:216][file] Markdown padding; [PaneBody:51][pane] and [SettingsSectionFrame:67][settingsFrame] page padding. [UsageListPopover:76–78][usage] swaps icon/word. |
| Composer controls mix viewport and input | [styles.ts:3–22][styles] gives shared picker triggers 44→32px at md, Send/Stop 44→36px, narrower-screen menu captions and md input padding. Consumers are New page directory/trust/worktree pickers, model/delivery triggers and both composers. [ModelSelect:214–263][model] also has max-md search text, sm list-height change and coarse effort controls. [PianoViewToggle:10–23][viewToggle] gives file Preview/Source 44→36px at md; the global coarse toggle **minimum** still applies. These are not all the same control contract. |
| Coarse control consumers | [Session header:185][header], [Artifacts:35][artifact], [rail rows][railRows] and [section fold buttons:316–323][railSections], [Preview row:137][previewRow], [Changes rows:349,375][changes], [Changes header:42][changesHeader], [PR row:108][prRow], [Settings navigation:74][settingsNav], model effort above. These grow hit areas without changing layout mode. [Reply Copy:684][message] and [quote Remove:50][quotes] become visible without hover. |
| Coarse behavioral consumers | [keys.ts:30–36][keys] makes Enter a newline, including wide coarse devices; [DraftEditor:120–159][draft] consumes that policy. [Picker:27–32][picker] focuses content instead of search; [NewSession:181][newPage] suppresses autofocus; [Quotes:84–139][quotes] suppresses the selection-based Add to chat pill and listens for capability changes. [SlashTextarea:292–337][slash] uses **event pointerType**, preserving touch scrolling and mouse highlighting. Do not replace these with viewport width or infer attached-keyboard capability. |
| Height, safe area and fitting | [AppLayout:55][shell] uses 100dvh; [NewSession:75–92][newPage] changes md welcome layout, logo/description visibility, title and input dimensions. [index.css:681–703][cssShort] independently reduces welcome chrome at height ≤500px. Composer/queue, pickers, sheet and dialogs cap height using dvh or Radix available height; Pane/Composer/reveal/sheet pad for bottom safe area. [web/index.html:6–21][html] sets viewport width/initial scale, not viewport-fit=cover. Inspect real keyboard/safe-area behavior; no meta-tag change is authorized by this plan. |
| Local measured fitting | [MiddleEllipsis:7–33][ellipsis] fits branch text; [FilePdf:30–53][pdf] follows viewer width; [PianoTabs:7–60][strip] keeps selected tabs visible and routes wheel overflow; [MessageList:712–731][message] measures prompt overflow; [SessionRail:104–130][rail] handles rail overflow. Sidebar virtualization measures CSS as above; transcript virtualization's [initial width 768][virtual] is a seed rect, **not a responsive breakpoint**. SlashTextarea's overlay measures its own textarea. Leave these local. |
| Upstream viewport rules | [input][input] / [textarea][textarea] change text size at md; [AlertDescription][alert] changes text wrapping. [Dialog][dialog] has sm max-width/footer direction, [Sheet][uiSheet] sm limits only for left/right sheets, and [Breadcrumb][breadcrumb] sm gap. [Field][field] has a container-responsive orientation variant, but no application caller selects `orientation="responsive"` at this revision. Do not confuse container `@md` or component `size="sm"` with viewport md. |
| App sm adaptations | [ModelSelect list][model], [WebhookSettings event grid][webhook], [FolderPicker dialog][folderPicker] and [footer alignment][folderFooter]; max-widths in [palette][palette], [project settings][projectDialog], [project dialog][projectsDialog], [draft dialogs][draftDialogs], [API key][apiDialog], [share][shareDialog], [removal][removalDialog], [command dialogs][commandDialog], [extension dialog][dialogHost], [PR link][prDialog], [Preview confirmation][previewDialog] and [Preview details][previewDetails]. Keep these content-specific overlay constraints, outside the 768/849 consolidation. |
| Neutral responsive overrides | [SessionHeader breadcrumb][header] and [ProjectHome:126][projectCrumb] keep the same gap at sm; [Sidebar:332][sidebarPadding], [FolderPicker:227][folderFooter], [ContextDetails:95][contextPadding] keep the same padding at md to counter upstream defaults. Not independent policies or reasons to change layout. |
| Preferences other than size/input | [Reduced-motion CSS:951–984][cssMotion] and [transcript jump motion][virtualMotion] change motion, not layout choice. Color-scheme/`.dark` rules and [HTML theme media][html] are appearance preferences, not responsive capacity. Preserve them. |

### The upstream sidebar exception

The actual shell does **not** render stock shadcn's responsive Sidebar/SidebarInset/SidebarRail. It composes its provider and list primitives around Piano's own aside and [modal reveal][reveal] ([AppLayout][shell]). Stock geometric md/sm rules in [ui/sidebar.tsx:160–565][stockRest] therefore are not the shell's authoritative rules.

However the provider still runs upstream [useIsMobile][mobile]. Its [⌘B handler:91–115][stock] changes controlled desktop open state above the viewport boundary, but changes stock `openMobile` below it; Piano's reveal does not consume that field. The Settings [tooltip wrapper][tooltip] also reads its `isMobile`. This dual ownership is real and [already documented](../shadcn-ui.md#stock-sidebar-shortcut), not a newly observed browser bug. Do not silently connect the mobile shortcut or edit the generated hook in a cleanup PR. A shortcut behavior change needs a separate acceptance decision.

## Findings: evidence versus decisions

| Finding | Classification and consequence |
| --- | --- |
| “Phone” / “mobile” names describe behavior at wider viewports too. `AreaTabs` still says the rail opens in a sheet, although current navigation never shows a one-area rail. Quiet UI says the session header is one line, whereas its intentional narrow context is a second line. | **Proven documentation/naming drift:** [AreaTabs comment][areaTabs], [MobileSessionSheet][sheet], [glossary](../glossary.md), [Quiet UI shared structure](../quiet-ui.md#shared-structure), [navigation][navigation]. Correct language without restoring a removed rail sheet or removing context. |
| Header folder versus repository label | **Resolved by #555**, not work for #557. Rail still deliberately uses repository when known ([sessionPlace][context], [SessionEnvironment][railSections]). Do not change that shared selector to achieve a header-only rule. |
| 849 versus 768 | **Intentional different dimensions**, not conflicting thresholds. 849 measures remaining space; 768 governs navigation and density. Narrowing the sidebar can cross 849 without resizing the viewport. |
| Header sheet at wide one-area, crumb still visible, menu beside title | **Implemented mixed rule; intent needs confirmation before changing.** Keeping it is the behavior-preserving default. A single “mobile layout” flag would change multiple independent choices. |
| JS 768px occurs in both upstream hook and Piano controller; CSS says 48rem | **Proven duplicated definitions, not a demonstrated ordinary-width mismatch.** Upstream subscribes to max-width 767px but reads innerWidth <768; controller subscribes/reads min-width 768px. Fractional widths and non-default browser font settings deserve targeted observation. 48rem=768px is an assumption for the normal 16px media-query baseline, not universal equivalence. |
| Wide coarse controls differ from narrow fine controls | **Proven difference, not proven usability defect.** Header icons and tabs grow by input; composer exceptions shrink by viewport. Quiet UI explicitly permits some one-off sizes. Preserve until hardware evidence or an explicit sizing decision supports a focused change. |
| Rail could physically fit below 849 | **Unapproved optimization.** Its 320px width is smaller than Surface's 400px minimum, but the implemented mode/commands intentionally share one capacity rule. Lowering rail threshold creates a new mode; exclude it. |
| Exact boundary coverage missing | **Proven test-source gap:** tests inject layout booleans rather than deriving them from measured widths; no test imports `panelLayout.ts`. Browser endpoint checks are valuable but do not assert 767/768 or A=848/849. See coverage below. |

## Boundary and state matrix

### Geometry: source-derived expected values, not measured results

Let **V** be viewport CSS width, **W** the visible desktop sidebar width and **A** the areas-container width. With the current 16px root, 8px pane inset and 1px pane borders ([tokens][tokens], [shell][shell]):

- Below md: **A ≈ V**, including when the reveal is open; translation does not allocate sidebar width.
- At/above md, sidebar expanded: **A ≈ V − W − 10** (right inset + two borders).
- At/above md, sidebar collapsed: **A ≈ V − 18** (both insets + two borders).

These are fixture calculations. Assertions must read the actual areas element's bounding rectangle after layout settles; zoom, scrollbars, CSS changes and media-query units can invalidate a predicted V. Do not implement these arithmetic formulas in JS; the ResizeObserver is the authority.

| Case | V | Sidebar | Expected A | Expected session mode / purpose |
| --- | ---: | --- | ---: | --- |
| Phone endpoint | 390 | reveal closed/open | 390 | One-area; modal reveal leaves session width unchanged. |
| Viewport just below | 767 | reveal closed/open | 767 | One-area; crumb hidden, menu at end. |
| Viewport boundary | 768 / 769 | expanded 288 | 470 / 471 | One-area; **column appears, crumb appears, sheet stays**, menu moves beside title. |
| Viewport boundary collapsed | 768 / 769 | collapsed | 750 / 751 | One-area; show-sidebar button remains. |
| Available-width boundary, collapsed | 866 / 867 / 868 | collapsed | 848 / 849 / 850 | One-area / side-by-side / side-by-side. |
| Intermediate toggle | 900 | expanded 288 → collapsed | 602 → 882 | One-area → side-by-side without viewport change. |
| Tablet-style width | 1024 | expanded 208 / 288 / 480 | 806 / 726 / 534 | All one-area despite a wide viewport. Collapsed A=1006 is side-by-side. |
| Available-width boundary, minimum sidebar | 1066 / 1067 / 1068 | expanded 208 | 848 / 849 / 850 | Same mode boundary with different sidebar geometry. |
| Available-width boundary, default sidebar | 1146 / 1147 / 1148 | expanded 288 | 848 / 849 / 850 | Essential open-sidebar boundary triplet. |
| Resize without viewport change | 1280 | expanded 288 → 480 | 982 → 790 | Side-by-side → one-area; transition near W=421 (A=849) / W=422 (A=848). |
| Available-width boundary, maximum sidebar | 1338 / 1339 / 1340 | expanded 480 | 848 / 849 / 850 | Checks maximum-width preference does not create another rule. |
| Hidden/unmeasured | any | Settings covers session | 0 | Retain last mode; remeasure on return. Not “one-area because zero.” |

For the pure geometry contract also include **848.5, 849, 849.5**, plus 0, to protect strict comparison without rounding. Around viewport 768 include 767/768/769 and an exploratory fractional/zoom check; record actual media matches instead of assuming emulation produces fractional layout widths.

### What each settled mode must show

| State | Header / menu | Areas, tabs and rail |
| --- | --- | --- |
| Narrow viewport + one-area | Folder/ref context; no project crumb; sheet trigger at end. | No Surface tabs: Agent only, no strip. With tabs: shared strip, only selected area visible/inert counterpart. No rail or rail command. |
| Wide viewport + one-area | Same folder/ref context and sheet; project crumb when assigned; trigger beside title. | Same area/rail contract as above, but viewport density remains wide. |
| Wide viewport + side-by-side | No context second line; project crumb when assigned; dropdown beside title. | Agent always visible. No tabs/rail off: Agent fills space. Tabs visible: Surface strip/splitter. Rail turned on last: rail replaces Surface, not its tabs/state. |
| Narrow viewport + side-by-side | Not a settled geometric result at normal settings. | Initial navigation starts `single=false`; measurement and upstream mobile state arrive separately ([initial state][navInitial], [hook][mobile]). Preserve fallback handling; test cold load and hidden-view return rather than deleting apparently redundant guards. |

Repeat a small orthogonal subset with **fine** and **coarse** input: 767, 768, 900 expanded/collapsed, and 1280 with sidebar at 288/480. Record media query matches. Changing input alone must not change area mode, menu kind, crumb visibility or rail eligibility; it should change the applicable control sizes/focus/Enter policies. Include a wide coarse device with a physical keyboard: coarse pointer is not proof there is no keyboard.

### Stateful transitions to exercise

1. At 900 or 1280, keep an unsent draft, a scrolled transcript and multiple Surface tabs; collapse/expand/resize sidebar across A=849 in both directions. Preserve selected session, tab order, reading position and draft; no Pi action or submission due to resize (INV-02, INV-07).
2. With rail remembered on, open Changes, cover it with rail, narrow, choose Agent, widen; confirm the existing projection, not an invented restoration rule. Exercise both rail preference values and no/open Surface tabs. Use existing navigation tests as the oracle.
3. Open the session sheet in wide one-area; cross A=849 to dropdown, then back. It must not reopen itself. Cross V=768 while staying one-area: check exactly one menu trigger, current project navigation, Escape and focus return after its position moves.
4. Resize while sidebar is being dragged; cross V=768, cancel and double-click reset. Reveal opening/closing never mutates desktop width/collapse preference. When Settings hides the session, zero measurement must not clear its layout or tabs; return and check the actual new capacity.
5. Open file/Changes/Preview, switch to Agent, close a tab and invoke Ask. Verify the destination and focus: tab navigation/close must not raise the software keyboard; Ask deliberately focuses the draft. Preserve mounted Preview identity when just changing areas or covering with rail.
6. Use long session/project/folder/branch names, no project, no branch, detached checkout, non-Git folder, and a GitHub remote whose repository name differs from folder. Header label follows #555; rail label remains unchanged. Check accessible names and inert regions, not textContent counts that include MiddleEllipsis's measuring/accessibility copies.

## Existing coverage and smallest missing checks

Coverage below was **read, not executed**. Existing test names do not prove browser geometry or touch hardware.

| Existing protection | What it proves / does not prove | Smallest useful addition or observation |
| --- | --- | --- |
| [start-session.mjs:1–50][start] | Folder/model/effort/project selection, first reply, project in header, reload without resubmission. Uses the harness's default 1280×900, not breakpoint or touch cases. | Retain the critical baseline; do not mistake a successful start for responsive-boundary evidence. |
| [SidebarLayout.test.ts:15–202][tSidebar] | Persistence, width clamping, drag-collapse, cancellation at a supplied breakpoint and focus fallback. Environment supplies a boolean; no real 768px media/CSS assertion. | Retain tests. Scratch observation of 767→768 and return, reveal/drag cancellation and actual geometry. Add a controller case only if a new state/subscription contract is introduced. |
| [Navigation.test.ts:864–1005][tNav], [1124–1338][tAreas] | Rail/Surface exclusivity, remembered rail, no narrow rail/process actions, file return areas, tabs through mode/Settings changes, shown-tab gating, disposable Preview memory. Calls `setSingle` directly. | Retain rather than rewrite around private helpers. Add focused public geometry tests for A=0/848/848.5/849/849.5/850 in a small `PanelLayout.test.ts`; these catch threshold/rounding/zero regressions not covered elsewhere. |
| [SessionCommands.test.ts:463–498][tCommands] | Rail hidden/disabled one-area, Agent enabled only with tabs; both use supplied layouts. | Keep. Browser check that measured layout reaches header, palette and tabs consistently. Do not add another table of the same booleans. |
| [SessionContext.test.ts:691–738][tContext], [MiddleEllipsis.test.ts][tEllipsis] | Repository/folder/ref selection and fitting algorithm; not header label wiring or viewport truncation. | One contrasting folder/remote browser fixture around both boundaries, including project/no-project. #555's PR reports such observations, but not a new durable test or real-device run. |
| [open-session.mjs:515–584][browserHeader] | At 1280, project crumb/no branch context; rail button Space/Enter once. At 600, sheet/no rail and Escape focus; draft retained. [285–336][browserResize] covers prompt expansion/copy visibility at 800/390/1280. | Extend the existing open-session journey only for the meaningful **wide one-area → side-by-side** header/area wiring regression, measuring A; do not create a third general responsive journey. Use per-PR scratch assertions for the full matrix. |
| [style-shots.mjs:110–183][shots], [transcript-rows:303–338][alignment] | Evidence gallery: desktop menus/Changes and 390px sheet/project page; row alignment at representative widths. Neither is a boundary contract. | Before/after style shots for any wrapper/token/style edit. Run row measurements if typography/gutters change, with narrow, intermediate and wide samples. No new row kind is proposed. |
| [preview.mjs:391–449][previewTests], [915–1033][previewNarrow] | Opt-in real-supervisor fixture: Surface resize, narrow Preview actions, state preservation and synthetic touch when local embedding is available. Not physical-device evidence or generic 849 coverage. | Reuse only if panel mounting/resize/Preview containment changes; avoid starting an app merely to verify a renamed header flag. Report embedded/native-platform skips separately. |
| [SwipeGesture.test.ts:36–294][tSwipe] | Gesture claims/cancellation/flick/selection policy, not DOM exclusions or Safari edge behavior. [TranscriptViewport.test.ts:49–160][tViewport] protects reading intent on size changes. | Retain; scratch check DOM cancellation if shell wiring changes. Real device needed for browser-edge navigation, scroll/selection and keyboard behavior. |
| [Keys.test.ts:1–18][tKeys] | IME helper only, not coarse Enter. | If input policy changes, add a focused Send/newline contract check and observe actual input; do not add it just for vocabulary edits. |

For implementation evidence, capture **V, height, A, sidebar width/collapse/reveal state, pointer media matches, active area/tab, rail preference/visibility, header context/crumb and menu type/position**, plus screenshot and relevant accessibility/focus assertions. Wait on the expected state/measurement, not arbitrary sleeps. Use pointer-driven clicks for Radix. Inspect each changed control/action once and screenshot its answer per Quiet UI.

### Real hardware is a separate evidence gate

A responsive desktop screenshot or CDP synthetic touch is not a hardware result. After any input/layout behavior change, separately record device, OS/browser, orientation, pointer/hover matches, physical keyboard/trackpad presence, keyboard-open state and safe-area conditions. Minimum useful checks: a real phone in portrait/landscape and a wide touch tablet or equivalent, testing picker focus, Send/newline, header/menu reachability, tab overflow, reveal/scroll/text-selection conflicts and resize/orientation return. Test Safari edge navigation where supported. Report unavailable hardware as **not verified**, not a pass.

Use only a [verify-piano scratch instance](../../.agents/skills/verify-piano/SKILL.md) with its own state and private access; keep loopback/private access (INV-11), never the user's running Piano/database. No public/LAN binding workaround. Touch-sizing improvements should wait for the relevant evidence/decision, not block a documentation-only PR.

## Bounded implementation sequence

These are future changes, not instructions executed by this research. Each PR must name its bounded claim, preserve the cited contracts, and retain evidence against its own revision including dirty inputs (INV-08/09).

### 1. Adopt vocabulary and remove misleading comments

**Depends on:** review of the definitions above; #555 retained on the implementation base.

**Files:** glossary; Quiet UI's header wording; comments in SessionView, SessionRail, navigation and sidebarLayout; rename `MobileSessionSheet` to `SessionMenuSheet` with its one header import. Describe `single` explicitly and call the header's viewport signal `narrowViewport`, not phone/input capability. Do not rename upstream `use-mobile.ts` or storage keys.

**Acceptance:** all references distinguish area mode, viewport and pointer; no assertion that a one-area rail sheet exists; folder/ref context retained; no UI labels, controls, persistence or thresholds change. One coherent naming/docs PR, not a new layout service. **Risk:** import/comment drift or accidental selector changes. **Invariants:** INV-01/02/07; document review for docs alone, normal gates if code is renamed.

### 2. Protect and consolidate the capacity seam

**Depends on:** step 1 vocabulary; no product decision needed to retain current geometry.

**Files:** keep `panelLayout.ts` as geometry owner (do not create a competing responsive module); SessionView remains the measurement adapter; navigation remains visibility/state owner; focused `PanelLayout.test.ts` for the missing observable width rule. Document the measurement box and unmeasured sentinel. Audit consumers against the decision map, removing a redundant derivation only when the existing navigation projection expresses exactly the same rule.

**Acceptance:** strict 849 boundary and zero retention protected; no viewport calculation substituted for ResizeObserver; preferred Surface width clamps without changing mode threshold; tabs/rail/draft/session lifecycle unchanged. Observe collapsed/default/max-sidebar boundary cases before/after. **Risk:** off-by-one border accounting, rounding, initial or hidden measurements and layout oscillation. **Invariants:** INV-01/02/07/09. Existing navigation tests remain the state contract; do not export private derivations just to test them.

### 3. Consolidate application viewport ownership, explicitly retaining upstream exceptions

**Depends on:** steps 1–2; boundary/startup observations; unit choice decision below if changing query semantics.

**Files:** a small application-owned viewport module/hook (for example `lib/viewportLayout.ts` and `lib/useViewportLayout.ts`) used by `browserSidebarEnvironment` and SessionHeader. Share the existing 768px threshold/query ownership and a reactive read/subscription, not a global “isMobile” combining mode and pointer. Keep CSS md/48rem in its styling role and explain the relationship at the query/token owners. Keep upstream `use-mobile.ts` and `ui/sidebar.tsx` upstream-owned, with their documented provider/tooltip role.

**Acceptance:** header and controller agree at 767/768/769, startup and breakpoint transitions; CSS shell agrees under the supported settings; changing viewport with no drag/reveal still notifies the header. Do **not** subscribe only to the controller's current state: [its snapshot][sidebar] has no viewport field and can stay identical across a crossing ([hook][sidebarHook]). Do not change mobile ⌘B or migrate upstream primitives opportunistically. **Risk:** first-render fallback, subscription cleanup, fractional widths, rem/px divergence. **Invariants:** INV-01/02/09; shadcn ownership policy.

This is consolidation of Piano-owned consumers, not a false claim of one generated constant controlling all CSS and upstream code. Avoid a code generator/build dependency merely to eliminate one documented CSS/JS correspondence.

### 4. Make header policy explicit and verify intermediate states

**Depends on:** steps 2–3. Any actual presentation change also depends on the decisions below.

**Files:** SessionHeader and renamed SessionMenuSheet; extend the existing open-session regression where needed. Group/name the decisions separately: menu presentation/context eligibility (currently viewport OR one-area), trigger placement (viewport), breadcrumb visibility (viewport CSS), rail eligibility (navigation), and target size (pointer). Keep folder naming local to the header. No new persistent state store or shared “compact” boolean.

**Acceptance:** all three settled matrix rows retain their current behavior; cold-load fallback is observed; exactly one trigger; project action still reachable; widening closes the sheet without later resurrection; no hidden rail command; accessible area labels and keyboard focus survive. Keep the wide one-area crumb and sheet position unless separately approved. **Risk:** moving triggers remounts overlays, restoring focus to inert content, duplicate facts or keyboard pop-up. **Invariants:** INV-02/07/09 and Quiet UI's Once/Same names/Feedback checks.

### 5. Only evidence-backed sizing or interaction corrections

**Depends on:** matrix and real-device results identifying a specific failure, plus approval for the changed contract.

**Scope:** at most one control family or one shell interaction per PR. Use Piano wrappers/tokens for sizes; retain intentional viewport density and the composer's documented exceptions. Treat shortcut ownership, breadcrumb simplification, rem/px normalization and hardware-keyboard Enter policy as separate decisions, not cleanup side effects.

**Acceptance:** reproduce the identified failure, show the smallest correction and preserved neighboring states; before/after style shots for CSS/Piano wrappers; affected action and its answer captured; hardware evidence reported separately. **Risk:** larger controls cause truncation/vertical crowding, touch changes break keyboard access, wrapper changes affect unrelated panes. **Invariants:** INV-02/07/09/11. No dependency upgrade, server/wire change, rail redesign or persisted-key migration.

For every code PR: `npm run typecheck`, `npm run lint`, `npm test`; observe the affected scratch journey and retain output on the PR. Use existing critical journeys rather than inventing a new path for this refactor. Do not claim full touch verification from those gates. [Testing policy](../testing.md#completion-evidence).

## Decisions left open (defaults preserve current behavior)

1. **Wide one-area header:** keep project crumb and beside-title sheet trigger, or deliberately make all one-area headers share the narrow presentation? Recommendation: keep; inspect long names and available room first. Changing it gates only that behavior change, not vocabulary/coverage work.
2. **Touch control families:** should wide coarse composer picker/Send exceptions grow to narrow-viewport sizes, and should a coarse device with a physical keyboard send on Enter? Recommendation: separate ergonomics work only after hardware evidence; no inferred input capability from width.
3. **Viewport units and initial state:** retain JS px plus documented default CSS relationship, or align app JS to CSS 48rem (including changed browser-default-font behavior)? Recommendation: retain values initially; observe fractional/zoom/font cases, then approve semantics explicitly. Preserve the `mobile || single` fallback unless startup evidence supports removing it.
4. **Sidebar keyboard shortcut:** should ⌘B below md control Piano's reveal rather than stock disconnected `openMobile`? Recommendation: track separately; it is a documented ownership exception, not permission to alter upstream in this consolidation.

No unresolved decision blocks this **research-only** deliverable. None is silently resolved by the plan. No new ADR is necessary for these reversible local ownership clarifications; a future change to the architectural contracts would require its own review.

## Research method and limits

Inspected issue #557, PR #555 (body, commits, file diff and merge comparison) through GitHub CLI with `GH_HOST=github.int.exe.xyz` / repository `goofansu/piano`; traced viewport/media classes, pointer queries, area-mode consumers, local measurements and relevant tests in this checkout. First-party repository source and GitHub APIs were sufficient; no external product research was needed.

Environment: exe.dev Linux 6.12.115 x86_64, Node 26.13.0, Git 2.43.0, gh 2.101.0. **Validation scope:** document/link/source-reference review only. No app, test suite, model calls, device simulation, real-device checks, restart, deployment or live database access. Geometry tables are derived expectations; #555's reported browser results belong to that PR/revision, not to this research. Implementation evidence must be recaptured on the then-current base.

## Pinned source references

Link labels in the tables include the relevant file/lines; the definitions below pin them so future code changes do not silently alter this research's evidence.

[geometry]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/lib/panelLayout.ts#L1-L34
[measurement]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SessionView.tsx#L73-L113
[agent]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SessionView.tsx#L145-L288
[areaTabs]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SessionView.tsx#L293-L342
[navigation]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/lib/navigation.ts#L59-L104
[moves]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/lib/navigation.ts#L701-L745
[navInitial]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/lib/navigation.ts#L434-L454
[panel]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SessionPanel.tsx#L84-L266
[surface]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SurfaceArea.tsx#L34-L214
[header]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SessionHeader.tsx#L56-L290
[sheet]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/MobileSessionSheet.tsx#L161-L305
[rail]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SessionRail.tsx#L51-L130
[railSections]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SessionRail.tsx#L174-L334
[railRows]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SessionRailList.tsx#L1-L21
[commands]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/lib/sessionCommands.ts#L379-L397
[context]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/lib/sessionContext.ts#L311-L340
[shell]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/AppLayout.tsx#L28-L139
[sidebar]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/lib/sidebarLayout.ts#L1-L243
[sidebarHook]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/lib/useSidebarLayout.ts#L10-L29
[stock]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/ui/sidebar.tsx#L55-L132
[stockRest]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/ui/sidebar.tsx#L160-L565
[mobile]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/hooks/use-mobile.ts#L1-L19
[showSidebar]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/ShowSidebarButton.tsx#L11-L46
[tooltip]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/PianoSidebarMenuButton.tsx#L5-L24
[reveal]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/PianoSidebarReveal.tsx#L6-L69
[swipe]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/lib/useSidebarSwipe.ts#L12-L231
[rows]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SidebarSessionList.tsx#L25-L190
[window]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/lib/useSidebarWindow.ts#L6-L73
[tokens]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/index.css#L82-L99
[typography]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/index.css#L223-L242
[cssTouch]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/index.css#L350-L362
[cssReveal]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/index.css#L374-L453
[cssSidebar]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/index.css#L484-L491
[cssShort]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/index.css#L681-L703
[cssRows]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/index.css#L878-L933
[cssMotion]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/index.css#L951-L984
[button]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/PianoButton.tsx#L12-L30
[rowActions]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/RowActions.tsx#L4-L33
[strip]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/PianoTabs.tsx#L7-L143
[commandSize]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/PianoCommand.tsx#L24-L88
[styles]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/lib/styles.ts#L1-L22
[composer]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/Composer.tsx#L128-L287
[picker]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/Picker.tsx#L7-L35
[quotes]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/Quotes.tsx#L26-L139
[keys]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/lib/keys.ts#L26-L36
[draft]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/DraftEditor.tsx#L120-L159
[slash]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SlashTextarea.tsx#L292-L337
[newPage]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/NewSession.tsx#L75-L198
[viewToggle]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/PianoViewToggle.tsx#L5-L23
[model]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/ModelSelect.tsx#L214-L263
[changes]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/Changes.tsx#L338-L381
[changesHeader]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/ChangesHeader.tsx#L30-L47
[prRow]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SessionPullRequest.tsx#L100-L110
[previewRow]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SessionPreview.tsx#L124-L143
[artifact]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SessionArtifacts.tsx#L23-L43
[message]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/MessageList.tsx#L675-L731
[messagePadding]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/MessageList.tsx#L194-L208
[skeleton]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SessionView.tsx#L416-L425
[banner]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/Banner.tsx#L34-L45
[pane]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/Pane.tsx#L17-L53
[file]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/WorkspaceFile.tsx#L170-L220
[usage]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/UsageListPopover.tsx#L65-L84
[settingsFrame]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SettingsSectionFrame.tsx#L60-L70
[settingsNav]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SettingsPage.tsx#L63-L80
[input]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/ui/input.tsx#L1-L18
[textarea]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/ui/textarea.tsx#L1-L17
[alert]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/ui/alert.tsx#L50-L64
[dialog]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/ui/dialog.tsx#L54-L115
[uiSheet]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/ui/sheet.tsx#L55-L72
[breadcrumb]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/ui/breadcrumb.tsx#L16-L29
[field]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/ui/field.tsx#L39-L75
[html]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/index.html#L6-L21
[pdf]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/FilePdf.tsx#L30-L53
[ellipsis]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/MiddleEllipsis.tsx#L7-L33
[virtual]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/lib/useVirtualTranscript.ts#L28-L35
[virtualMotion]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/lib/useVirtualTranscript.ts#L103-L117
[tSidebar]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/test/SidebarLayout.test.ts#L15-L202
[tNav]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/test/Navigation.test.ts#L864-L1005
[tAreas]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/test/Navigation.test.ts#L1124-L1338
[tCommands]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/test/SessionCommands.test.ts#L463-L498
[tContext]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/test/SessionContext.test.ts#L691-L738
[tSwipe]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/test/SwipeGesture.test.ts#L36-L294
[tKeys]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/test/Keys.test.ts#L1-L18
[tEllipsis]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/test/MiddleEllipsis.test.ts#L1-L32
[tViewport]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/test/TranscriptViewport.test.ts#L49-L160
[browserHeader]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/test/browser/open-session.mjs#L515-L584
[browserResize]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/test/browser/open-session.mjs#L285-L336
[shots]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/test/browser/style-shots.mjs#L110-L183
[previewTests]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/test/browser/preview.mjs#L391-L449
[previewNarrow]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/test/browser/preview.mjs#L915-L1033
[alignment]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/test/browser/transcript-rows.mjs#L199-L338
[start]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/test/browser/start-session.mjs#L1-L50
[app]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/App.tsx#L58-L100
[hookNav]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/lib/useNavigation.ts#L12-L44
[folderPicker]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/FolderPicker.tsx#L65-L73
[folderFooter]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/FolderPicker.tsx#L223-L240
[sidebarPadding]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/Sidebar.tsx#L325-L335
[contextPadding]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/ContextDetails.tsx#L90-L100
[projectCrumb]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/ProjectHome.tsx#L122-L129
[palette]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/CommandPalette.tsx#L70-L80
[webhook]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/WebhookSettings.tsx#L412-L427
[draftDialogs]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/DraftDialogs.tsx#L145-L241
[projectDialog]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/ProjectSettings.tsx#L34-L45
[projectsDialog]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/Projects.tsx#L261-L270
[apiDialog]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/ApiKeySettings.tsx#L183-L192
[shareDialog]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/ShareSessionDialog.tsx#L65-L75
[removalDialog]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/RemovalDialog.tsx#L43-L53
[commandDialog]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/CommandHost.tsx#L301-L352
[dialogHost]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/DialogHost.tsx#L51-L64
[prDialog]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SessionPullRequest.tsx#L252-L261
[previewDialog]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SessionPreview.tsx#L362-L372
[previewDetails]: https://github.com/goofansu/piano/blob/4f2babc19b2bee94f1043d3b01255249b46a9620/web/src/components/SessionPreview.tsx#L548-L558
