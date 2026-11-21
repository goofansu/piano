import { fileURLToPath } from "node:url";

const tailwindTheme = fileURLToPath(import.meta.resolve("tailwindcss/theme.css"));

const runtimeProperties = {
  "--lines": "0",
  "--sidebar-progress": "0",
  "--sidebar-reveal-width": "0",
  "--sidebar-reveal-radius": "0",
  "--sidebar-duration": "0",
  "--sidebar-easing": "linear",
  "--token-light": "currentColor",
  "--token-dark": "currentColor",
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
