import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The database-backed suite, kept separate from vitest.config.ts on purpose.
 *
 * That config's own comment says action- and page-level tests "need a
 * scratch database and are a separate, later step". This is that step, and
 * it stays separate for the reason given there: the unit suite runs in a
 * second with no Postgres, so it can gate every push. This one cannot, and
 * a suite that needs a database it might not have is a suite that gets
 * skipped and then quietly rots.
 *
 * Run it against a SCRATCH database — never a real one; it creates and
 * deletes companies:
 *
 *   pg_ctl -D /tmp/pg -o '-p 5433 -k /tmp/pgsock' start
 *   createdb -h /tmp/pgsock -p 5433 prova_test
 *   export DATABASE_URL='postgresql://you@localhost:5433/prova_test?host=/tmp/pgsock'
 *   export DIRECT_URL="$DATABASE_URL"
 *   pnpm --filter @prova/db exec prisma migrate deploy
 *   pnpm --filter @prova/web exec vitest run --config vitest.db.config.ts
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.dbtest.ts"],
    exclude: ["node_modules/**", ".next/**"],
    // One file at a time: these share a database, and parallel workers
    // racing on the same rows would produce failures that are about the
    // test runner rather than the code.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
