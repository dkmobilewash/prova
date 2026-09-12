import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The routing eval: real model, real prompt, no database. Kept out of the
 * unit config (which must run in a second with nothing but Node) and out
 * of the db config (which must not spend money) for the same reason both
 * of those exist — a suite that needs something it might not have is a
 * suite that gets skipped and then quietly rots. This one is run by hand,
 * before a prompt or model change, by whoever has a key:
 *
 *   ANTHROPIC_API_KEY=… pnpm --filter @prova/web ask:eval
 *
 * It refuses to run without the key rather than passing on nothing.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.eval.ts"],
    exclude: ["node_modules/**", ".next/**"],
    // One case at a time, so the per-case verdicts read in order and a
    // rate limit hits one request rather than forty.
    fileParallelism: false,
    testTimeout: 90_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
