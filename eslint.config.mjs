import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Compiled output for the Node test runner (see tsconfig.test.json).
    // It is CommonJS by design, so linting it only reports `require` usage.
    ".test-build/**",
    // Verification harnesses — plain CommonJS Node scripts run outside Next,
    // so `require` is correct there and the React rules do not apply.
    "scripts/**",
  ]),
]);

export default eslintConfig;
