# Desktop session navigation

## Developer navigation

Start at `adjacentSidebarSession` in `web/src/features/navigation/sidebar/sidebarList.ts` and
`web/src/features/navigation/sidebar/useSidebarSessionNavigation.ts`; the server side is the `select` drain in
`server/app/ClientDispatch.ts`.

Reveal geometry (`useSidebarWindow.ts`) has no module test: it is proven only by the
`session-arrows` steps of `node test/browser/open-session.mjs <evidence-directory>`.
