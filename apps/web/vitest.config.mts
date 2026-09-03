import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Unit tests for the pure logic in this app — the derived-state and date
 * functions that decide what a page says.
 *
 * Deliberately scoped to modules with no database, no network and no React:
 * `orderState`, `isLate`, `submittalState`, `daysBetween` and friends are
 * plain functions, and they are where this project's real bugs have lived
 * (a reissued case number, a same-day answer that was impossible, a
 * superseded revision shown as current). Those never needed a browser to
 * catch — they needed the code path actually executed with real inputs.
 *
 * Action- and page-level tests need a scratch database and are a separate,
 * later step; nothing here talks to Postgres, so this suite runs in a
 * second and can gate every push.
 */
export default defineConfig({
  // navItems.tsx carries an inline SVG per entry, so importing it from a
  // test compiles JSX. The automatic runtime means that works without every
  // such module importing React purely to satisfy the test environment --
  // which is the same runtime Next already uses, so nothing here diverges
  // from how the app is built.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
