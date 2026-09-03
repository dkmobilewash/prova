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
  // The app compiles JSX with the automatic runtime (next/tsconfig sets
  // "jsx": "preserve" and Next injects it); esbuild defaults to the classic
  // one and turns every icon into a bare `React.createElement`, which throws
  // "React is not defined" the moment a test imports a .tsx module. Nothing
  // here renders — navItems.tsx is imported for its route table, and the
  // icons just have to survive being constructed.
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
