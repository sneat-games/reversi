// ESLint flat config (v9+). Kept intentionally small for Wave 1 (engine +
// bot only, no Astro/DOM code yet) — mirrors the shape of
// bidding-tictactoe/web/eslint.config.mjs minus the Astro-specific pieces.
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      // TypeScript's own compiler already checks this; eslint's no-undef
      // otherwise false-positives on ambient/global types.
      "no-undef": "off",
    },
  },
];
