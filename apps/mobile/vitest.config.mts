import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The phone's pure logic, tested in node — and it starts with the sync
 * queue, which had no tests at all until a queued write was lost on a real
 * phone on 2026-09-20.
 *
 * Scoped deliberately: no React, no React Native, no device. Every module
 * under test here is plain TypeScript over AsyncStorage and `fetch`, both
 * of which are mocked. That is where the queue's real defects live — two
 * flushes racing each other, an op enqueued while a flush is in flight —
 * and none of them need a simulator to reproduce once the code is reachable
 * from a test at all.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
