# Desktop session navigation

## Developer navigation

Start at `adjacentSidebarSession` in `features/navigation/web/sidebar/sidebarList.ts` and
`features/navigation/web/sidebar/useSidebarSessionNavigation.ts`; the server side is the `select` drain in
`server/app/ClientDispatch.ts`.

Reveal geometry (`useSidebarWindow.ts`) has no module test: it is proven only by the
`session-arrows` steps of `node test/browser/open-session.mjs <evidence-directory>`.
