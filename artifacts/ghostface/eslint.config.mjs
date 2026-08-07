// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // React Native loads static assets and platform-specific native modules
      // via require(); this is idiomatic and not a code-quality concern.
      "@typescript-eslint/no-require-imports": "off",
      // console.warn / console.error are legitimate diagnostics in this app;
      // flag stray console.log/debug/info so they don't accumulate.
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".expo/**",
      "dist/**",
      "build/**",
      "scripts/**",
      "server/**",
      "assets/**",
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
  },
);
