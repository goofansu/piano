// Stylelint checks only names that do not exist: an unknown property, or a custom property that
// nothing defines. A misspelt or invented name passes the build and silently does nothing.
// Formatting belongs to oxfmt, and Tailwind classes to @shadcn/lint.
import { fileURLToPath } from "node:url";

/** Tailwind's default theme variables (`--spacing`, `--color-red-500`), which index.css imports. */
const tailwindTheme = fileURLToPath(import.meta.resolve("tailwindcss/theme.css"));

/** Custom properties that components set at runtime through `style`, not in CSS. */
const runtimeProperties = {
  // web/src/components/FileText.tsx, web/src/components/Changes.tsx
  "--lines": "0",
  // web/src/lib/useSidebarSwipe.ts
  "--sidebar-progress": "0",
  "--sidebar-reveal-width": "0",
  "--sidebar-reveal-radius": "0",
  "--sidebar-duration": "0",
  "--sidebar-easing": "linear",
};

/** @type {import("stylelint").Config} */
export default {
  plugins: ["stylelint-value-no-unknown-custom-properties"],
  rules: {
    "property-no-unknown": true,
    "csstools/value-no-unknown-custom-properties": [
      true,
      { importFrom: [tailwindTheme, { customProperties: runtimeProperties }] },
    ],
  },
};
