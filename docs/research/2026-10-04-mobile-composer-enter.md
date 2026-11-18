# Mobile composer Enter — 2026-10-04

## Bottom line

T3 Code provides an inspectable precedent for desktop Enter-to-send / Shift+Enter-to-edit and mobile Enter-to-edit, **but its “mobile” check is viewport width, not virtual-keyboard detection**. Codex CLI is not evidence for Codex mobile web behavior. Recommend a small, explicit Piano input policy using primary coarse pointer as a safety heuristic; do not describe it as detecting a virtual keyboard.

## Sources and method

Research date: 2026-10-04. Located official repositories through GitHub repository search and first-party site verification, then inspected cached source checkouts. [T3's official site](https://t3.codes) links **[pingdotgg/t3code](https://github.com/pingdotgg/t3code)**.

Inspected pins: T3 `eac52f0087d9ba5dee5542f24788d1482affae43`; OpenAI Codex `afb436df8b70bb5bc57b86d9a3e829968988cd21`. Links below pin source code; official documentation/spec links are live pages, accessed on the research date. Source inspection only: did not run upstream tests or observe their apps on devices.

## T3 Code: exact behavior

- **Detection:** `ChatComposer` sets `isMobileViewport = useMediaQuery("max-sm")` ([source L2344](https://github.com/pingdotgg/t3code/blob/eac52f0087d9ba5dee5542f24788d1482affae43/apps/web/src/components/chat/ChatComposer.tsx#L2344)). `sm` is 640 and `resolveMax` subtracts one: **`(max-width: 639px)`**. The hook uses `matchMedia`, subscribes to changes, and has a false server snapshot ([hook L1–87](https://github.com/pingdotgg/t3code/blob/eac52f0087d9ba5dee5542f24788d1482affae43/apps/web/src/hooks/useMediaQuery.ts#L1-L87)). It supports pointer queries, but this call does **not** use them. No UA, `maxTouchPoints`, touch events, hover query, keyboard-presence check or visual-viewport keyboard-height check in this submission decision. The separate sidebar `useIsMobile()` uses `max-md` (767px); it is not the composer's threshold.
- **Submission:** the resolver immediately returns null for mobile viewport, composing events, legacy IME `keyCode === 229`, or repeats. This blocks **all resolver-based send shortcuts**, including modified/remapped ones, on mobile. Otherwise default Enter submits; Shift+Enter and Alt+Enter do not. Preferences also support modifier-required sending for all prompts or only multiline prompts ([logic L28–71](https://github.com/pingdotgg/t3code/blob/eac52f0087d9ba5dee5542f24788d1482affae43/apps/web/src/composer-logic.ts#L28-L71)).
- **Editor:** `ChatComposer` passes the viewport result into that resolver ([L4327–4340](https://github.com/pingdotgg/t3code/blob/eac52f0087d9ba5dee5542f24788d1482affae43/apps/web/src/components/chat/ChatComposer.tsx#L4327-L4340)). Unhandled Enter in the TipTap editor splits a paragraph, preserving marks, or splits/exits a task item; IME Enter is intercepted first ([L962–1006](https://github.com/pingdotgg/t3code/blob/eac52f0087d9ba5dee5542f24788d1482affae43/apps/web/src/components/ComposerPromptEditorTiptap.tsx#L962-L1006)). Thus mobile Enter generally edits rather than sends, but autocomplete can consume Enter and list continuation can alter its editing action; it is not always a literal newline ([command handler L4346–4409](https://github.com/pingdotgg/t3code/blob/eac52f0087d9ba5dee5542f24788d1482affae43/apps/web/src/components/chat/ChatComposer.tsx#L4346-L4409)).
- **Tests:** resolver tests cover send preferences, desktop platforms and Shift+Enter ([L71–148](https://github.com/pingdotgg/t3code/blob/eac52f0087d9ba5dee5542f24788d1482affae43/apps/web/src/composer-logic.test.ts#L71-L148)); explicit non-submission cases cover mobile boolean, composition, 229 and repeat ([L238–246](https://github.com/pingdotgg/t3code/blob/eac52f0087d9ba5dee5542f24788d1482affae43/apps/web/src/composer-logic.test.ts#L238-L246)). These prove resolver contracts, **not actual iOS/Android keyboard behavior**. No relevant real-device/hybrid-keyboard test was located in the searched composer/hook tests.

## Codex: keep three surfaces separate

| Surface | Primary-source finding | Limit |
| --- | --- | --- |
| CLI terminal | Composer default submit is plain Enter; editor newline bindings include Shift+Enter, Alt+Enter and Ctrl+J. [Pinned keymap L1678–1695](https://github.com/openai/codex/blob/afb436df8b70bb5bc57b86d9a3e829968988cd21/codex-rs/tui/src/keymap.rs#L1678-L1695). Active paste bursts capture Enter as newline to avoid submission ([composer L3602–3614](https://github.com/openai/codex/blob/afb436df8b70bb5bc57b86d9a3e829968988cd21/codex-rs/tui/src/bottom_pane/chat_composer.rs#L3602-L3614)). | Terminal key-reporting capabilities affect modified keys. This is not a browser/mobile implementation. |
| Desktop app | Official [Settings / General](https://developers.openai.com/codex/app/settings/) documents “Require Cmd + Enter for multiline prompts.” Official [commands](https://developers.openai.com/codex/app/commands/) document app shortcuts. | Confirms a configurable multiline submission policy, not a mobile detector or exact default composer implementation. No proprietary desktop composer source inspected. |
| Web/cloud | Checked official [Codex Cloud documentation](https://developers.openai.com/codex/cloud/). | No primary-source confirmation found for virtual-keyboard Enter, desktop Shift+Enter, or its detection strategy. Treat those behaviors as **unverified**, not inferred from CLI, desktop, ChatGPT or the docs site's own navigation handlers. |

## Detection tradeoffs

The [W3C Media Queries specification](https://www.w3.org/TR/mediaqueries-4/#mf-interaction) explicitly says pointer/hover cannot detect keyboards. `pointer` describes the primary pointing device; `any-pointer` includes additional devices.

- **Width only (T3):** narrow desktop/physical-keyboard phone loses Enter-to-send; wide tablet or landscape phone can accidentally submit from its virtual keyboard. Responsive changes can change semantics during a session.
- **Primary `pointer: coarse`:** better aligns with touch-first devices regardless of width, but tablet + physical keyboard still gets newline. Adding a mouse may change the browser's primary-pointer classification; it is not keyboard detection.
- **Any touch / `any-pointer: coarse` / `maxTouchPoints`:** can classify hybrid touch laptops as mobile even when users type with their built-in keyboards. Avoid these as blanket send gates.
- **UA or keyboard-height heuristics:** UA identifies a platform, not the current keyboard; viewport changes also occur for unrelated reasons. They add complexity without establishing a reliable input-source contract.
- **IME:** composition confirmation must not send. Keep `isComposing`; the 229 fallback has an explicit T3 precedent. Test actual IME/browser combinations rather than claiming the guard proves all of them safe.

## Minimal Piano recommendation (no implementation here)

1. Keep the native textarea. On Enter, leave the default editing action alone when Shift is held, composition/229 is active, or the primary pointer matches `(pointer: coarse)`. Only desktop-policy Enter calls `preventDefault()` and the existing send path. Ignore repeat for submission. Query the current media match when handling the key, or use an existing reactive media hook; no UA/touch-event tracking needed.
2. State the contract honestly: **touch-first devices use Enter for newline and the Send button to submit**, including physical keyboards on those devices. This is a safety-biased approximation, not exact virtual-versus-physical keyboard detection. Do not combine coarse pointer with a maximum width (that reintroduces wide-tablet misses). If exact per-keyboard behavior is required, add an explicit preference later rather than pretending automatic detection is reliable.
3. Preserve an explicit send/queue control while Pi is working. In Piano's pre-fix `web/src/components/Composer.tsx`, streaming replaces Send with Stop although the placeholder invites queuing. A mobile Enter gate alone would remove the obvious queue path; account for that in implementation scope.
4. Smallest useful checks: desktop Enter sends once; Shift+Enter edits; coarse-pointer Enter preserves text/newline without sending; button sends; streaming still permits explicit queueing; composition/229/repeat do not submit. Observe iOS/Android virtual keyboards, a wide tablet, tablet physical keyboard and hybrid laptop separately. Browser emulation can check the policy but cannot prove virtual-keyboard delivery.

This note records source research, not verification of Piano's implementation. Application checks and browser evidence are reported separately.
