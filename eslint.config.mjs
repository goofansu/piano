import { plugin as shadcn } from "@shadcn/lint";
import tsParser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";

// Biome owns general linting; ESLint only checks Tailwind classes.
export default defineConfig([
  {
    files: ["web/src/**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { shadcn },
    rules: {
      // shadcn's Sonner wrapper uses this as a non-utility marker.
      "shadcn/no-unknown-classes": ["error", { allow: ["toaster"] }],
    },
  },
]);
