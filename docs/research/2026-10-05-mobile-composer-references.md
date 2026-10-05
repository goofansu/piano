# Mobile composer layout — Codex, T3 Code and Shelley

October 5, 2026. Research-only response to the user's clarification: **the problem is the mobile
layout on both the new-session and existing-session pages**, not a lack of animation.

## Recommendation

Use one compact mobile composer layout on both pages. Reserve the primary action's space, combine
model/effort selection, and separate project selection from the message toolbar. Do not rely on
wrapping the desktop controls until they fit. This is a proposed next slice, not implemented UI.

```text
New session only:  [Project / worktree                         ▾]

┌──────────────────────────────────────────────────────────────┐
│ Message…                                                     │
│                                                              │
│ [Model… · effort ▾]                        [2k]          [↑]  │
└──────────────────────────────────────────────────────────────┘
```

The diagram shows existing-session usage; a new session has no usage control yet. Send/Queue/Stop
continues to follow Piano's existing state contract. This is a structural sketch, not a pixel mockup.

- **Same mobile placement:** bottom-docked in both views, with the new-session welcome content above
  rather than vertically centering a large composer/hero. Keep desktop presentation separate.
- **One toolbar row:** a flexible, truncating model/effort trigger on the left; compact context usage
  and a reserved Send/Stop touch target on the right. Neither long model names nor effort changes
  may push the primary action onto a different row. Preserve the compact context readout and its
  details instead of introducing a new permanent diagnostic strip.
- **Project selection gets its own row on New:** one selected project/worktree control above the
  composer, not another wide chip competing with model selection and Send. Do not add metadata back
  to the intentionally quiet existing-session header.
- **Progressive disclosure:** choosing the combined model/effort control opens one viewport-bounded
  picker with both settings and the full model name. Do not add overflow controls for hypothetical
  features. A bottom sheet is an option to compare, not something all three references establish.
- **Typing gets priority:** modest initial input height, growth for actual content, a viewport-relative
  cap, safe-area padding, and 16px input text. Keep the toolbar stable as text grows. Aim for 44px
  primary touch targets; that is a Piano design target, not a measurement of these references.
- **Keyboard behavior is part of layout:** do not claim `dvh` or a viewport screenshot alone proves
  soft-keyboard behavior. Keep input and Send visible with the keyboard raised, avoid unnecessary
  picker-search autofocus on phones, and preserve focus, selection and drafts when closing a picker.

Prefer this simple layout over importing T3's whole collapsed/resting-composer state machine.
Preserve **INV-01–05, INV-07 and INV-11–12**: this is presentation and control grouping, not permission
to change Pi authority, queue/abort behavior, reconnect semantics or workspace identity.

## What the references actually do

### T3 Code: protect actions, adapt the settings group

Inspected `pingdotgg/t3code` at **`25d5c7cacb99bc50056edc0ea8d201eac31cfdf4`**.

- Its expanded footer is explicitly **non-wrapping**, with a separate flexible left controls group
  and a **non-shrinking** right actions group. The left group permits horizontal overflow; Send/Stop
  does not compete in a single wrapping list. [T1]
- It measures available width. Compact thresholds are 620px, or 780px for wide actions. Its shared
  settings fitting policy removes trailing labels, then moves trailing groups into overflow, before
  shrinking the model picker to its minimum readable width. This is a deliberate adaptation policy,
  not just `flex-wrap`. [T2], [T2a]
- The model trigger can shrink and truncate its label while preserving the icon/chevron. [T3]
- It also has a separate mobile collapsed presentation: when mobile, not forced expanded, unfocused
  and without a multiline draft, it can show a short prompt row with its own reserved action. That
  is distinct from its **desktop** scroll-driven resting layout; the latter explicitly excludes
  mobile. We should borrow prioritization, not conflate or immediately reproduce both mechanisms. [T4], [T4a]

**Takeaway for Piano:** reserve the action slot first. Make secondary controls adapt inside the
remaining space. T3 is not evidence that Piano should hide everything behind an icon or collapse
while the user is editing.

### Shelley: an explicitly different mobile arrangement

Inspected `boldsoftware/shelley` at **`966bd0a0023c88a4b9f6f0841663e5591ef93c55`**.

- `MessageInput` has separate textarea and controls elements. At widths up to 767px the form becomes
  `column-reverse`, so the controls appear **above** the full-width textarea. Mobile padding is
  reduced to 8px vertically / 12px horizontally, with bottom safe-area allowance. [S1], [S2]
- The controls row itself is a non-wrapping flex row. Its status slot is flexible/min-width-zero,
  while action buttons have fixed dimensions. Some status fields can wrap **inside that status
  group**; this is not a claim that Shelley forbids wrapping everywhere. [S2], [S3]
- Its unified model picker combines model and effort in one quiet control. The popover includes
  search/model choices and an effort radio-pill section. Long labels and viewport placement are
  handled separately from the send action. Inline/body-portal placement is explicitly used to
  avoid a narrow-viewport overflow problem. [S4]
- New/draft and established sessions reuse the same `MessageInput`, but not identical surrounding
  chrome: new/draft starts at three rows and keeps model/directory configuration in a standalone
  status area; established sessions start at one row and place status inline on mobile. [S5]
- Textarea CSS specifies 16px text, a 46px minimum and 200px maximum, plus native content sizing.
  The source comment explicitly connects 16px text with avoiding iOS focus zoom. These are source
  values, not physical-device measurements performed for this research. [S6]

**Takeaway for Piano:** treat mobile as a distinct layout, consolidate settings, and separate them
from input/actions deliberately. Shelley's controls-above-input is a valid alternative to compare;
we do not need to copy its whole status bar or adopt its queue semantics.

### Codex: useful control grouping, limited mobile evidence

- OpenAI's current official model documentation places a **model and reasoning control beneath the
  composer** in the desktop app and ChatGPT Work web surface, with deeper choices in Advanced.
  The page is now branded ChatGPT Learn and describes several surfaces. This supports grouping
  related settings; it does **not** establish exact Codex phone breakpoints, wrapping rules, input
  height, or virtual-keyboard behavior. [C1]
- The public `openai/codex` repository, inspected at
  **`a6c5f3a9fa8e7ccfba7d53921d2f06d06d3b9f79`**, identifies itself as **Codex CLI** and links separately
  to desktop and web experiences. Its terminal composer is not evidence for the proprietary web
  composer's CSS. No authenticated Codex app was inspected. [C2]

**Takeaway for Piano:** take the model/effort grouping principle. Do not label a guessed mobile
layout as “what Codex does,” or substitute ordinary ChatGPT mobile screenshots for Codex evidence.

## Why Piano's current layout feels wrong on phones

Source inspection at Piano **`0514c50`**:

- Both `Composer.tsx` and `NewSession.tsx` put all footer controls in one `flex-wrap` container.
  The shared picker allows 256px width, and the button primitive is `shrink-0`. On a 390px screen,
  the card has only 358px overall width before inner padding. [P1], [P2], [P3], [P4]
- New adds Directory to the same wrapping group; existing sessions substitute Context usage. The
  layout therefore changes with the model label, project name and state, rather than following a
  defined mobile hierarchy. New also uses a centered welcome layout and a 112px minimum input,
  while the existing-session input has a 56px minimum. [P1], [P2]

Retained **earlier browser evidence**, not a fresh app run during this research:

| 390 × 844, long-label fixture | New session | Existing session |
| --- | --- | --- |
| Card height | 232px | 140px |
| Input height | 112px | 56px |
| Footer height | 118px | 82px |
| Visible toolbar rows | 3 | 2 |

Source: `/tmp/piano-ui-polish-evidence/composer/new-390x844.json`,
`idle-390x844.json`, and matching PNGs. These are deliberately long fixture labels, not measurements
of the user's actual selected model. The original checks passed because there was no overlap or
out-of-bounds control. **Fitting inside the viewport is weaker than a good mobile composition.**
The first pass improved styling but did not resolve this structural problem.

## Next implementation gate, if approved

1. Observe both pages at 320/375/390/430px with short and long project/model labels. Assert a single
   toolbar row and a stable primary-action position, not merely no overflow.
2. Check one-line and multiline drafts, growth/cap, queue content, Send/Queue/Stop, and rejected input.
   Keep existing prompt and reconnect tests; this layout must not change their meaning.
3. Open the model/effort picker by touch, select each setting, close it, and check focus/draft/selection
   retention. Verify long labels and keyboard navigation; full names remain available inside the picker.
4. Observe portrait, landscape, raised keyboard and safe-area behavior on actual iOS Safari/Android
   where available. Browser emulation covers geometry, not OS keyboard behavior; report unavailable
   physical-device checks as limitations.
5. Review a mobile prototype/screenshots with the user before another broad visual change or deployment.

## Method and limits

Research performed directly; no background-agent tool was available. Refreshed the reusable source
caches and inspected pinned code read-only; no reference-repository scripts or apps were executed.
Used primary OpenAI documentation rather than secondary blog UI descriptions. Reviewed existing
Piano source and retained screenshots/geometry. Source inspection is not fresh reference-app browser
verification, and it does not establish that these products are universally better.

This change adds only this note. Checked source references and local links; no new application run
or unit suite is warranted. **No restart needed; no build, deployment or browser reload performed.**

## Sources

[T1]: https://github.com/pingdotgg/t3code/blob/25d5c7cacb99bc50056edc0ea8d201eac31cfdf4/apps/web/src/components/chat/ChatComposer.tsx#L7440-L7563
[T2]: https://github.com/pingdotgg/t3code/blob/25d5c7cacb99bc50056edc0ea8d201eac31cfdf4/apps/web/src/components/composerFooterLayout.ts#L1-L24
[T2a]: https://github.com/pingdotgg/t3code/blob/25d5c7cacb99bc50056edc0ea8d201eac31cfdf4/apps/web/src/components/composerFooterLayout.ts#L174-L223
[T3]: https://github.com/pingdotgg/t3code/blob/25d5c7cacb99bc50056edc0ea8d201eac31cfdf4/apps/web/src/components/chat/ProviderModelPicker.tsx#L205-L284
[T4]: https://github.com/pingdotgg/t3code/blob/25d5c7cacb99bc50056edc0ea8d201eac31cfdf4/apps/web/src/components/chat/ChatComposer.tsx#L2389-L2411
[T4a]: https://github.com/pingdotgg/t3code/blob/25d5c7cacb99bc50056edc0ea8d201eac31cfdf4/apps/web/src/components/composerFooterLayout.ts#L26-L56
[S1]: https://github.com/boldsoftware/shelley/blob/966bd0a0023c88a4b9f6f0841663e5591ef93c55/ui/src/vue/components/MessageInput.vue#L277-L329
[S2]: https://github.com/boldsoftware/shelley/blob/966bd0a0023c88a4b9f6f0841663e5591ef93c55/ui/src/styles.css#L6441-L6524
[S3]: https://github.com/boldsoftware/shelley/blob/966bd0a0023c88a4b9f6f0841663e5591ef93c55/ui/src/styles.css#L3643-L3664
[S4]: https://github.com/boldsoftware/shelley/blob/966bd0a0023c88a4b9f6f0841663e5591ef93c55/ui/src/vue/components/ModelPicker.vue#L1-L162
[S5]: https://github.com/boldsoftware/shelley/blob/966bd0a0023c88a4b9f6f0841663e5591ef93c55/ui/src/vue/components/ChatInterface.vue#L3803-L3833
[S6]: https://github.com/boldsoftware/shelley/blob/966bd0a0023c88a4b9f6f0841663e5591ef93c55/ui/src/styles.css#L3290-L3331
[C1]: https://developers.openai.com/codex/models
[C2]: https://github.com/openai/codex/blob/a6c5f3a9fa8e7ccfba7d53921d2f06d06d3b9f79/README.md#L1-L10
[P1]: ../../web/src/components/Composer.tsx
[P2]: ../../web/src/components/NewSession.tsx
[P3]: ../../web/src/lib/styles.ts
[P4]: ../../web/src/components/ui/button.tsx
