import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * OPERATOR TASKS: `*.task.ts`. Not tests, and not in CI.
 *
 * A task is something a person runs by hand against a real database — the CSLB
 * phone fill is the first. It is written in app TypeScript because it has to use
 * the app's own rules (`licenceKey` decides what a licence number is, and a second
 * copy of that rule in a script is the failure `lib/cslb/masterFile.ts` documents),
 * and that is the whole reason this config exists.
 *
 * ── WHY NOT ANY OF THE FOUR THINGS TRIED FIRST ──
 *
 *   - **a plain `node scripts/x.ts`.** Node 22.22 strips types natively, so this
 *     looked free. It is not: every import in this app is extensionless, which Node
 *     ESM cannot resolve, and the workspace package `@prova/db` resolves only from
 *     inside the package. Making it work would mean rewriting app imports to carry
 *     `.ts`, for a script.
 *   - **an `.mjs` script in `packages/db/scripts/`**, like `seed-demo.mjs`. It
 *     cannot import the TypeScript rules, so it would carry its own copy of the
 *     licence normaliser — the one thing this feature must not do.
 *   - **`vitest.eval.config.mts`**, whose `include` would need one glob added. Its
 *     header is entirely about real model calls and an API key, and it reads a
 *     `.env` for secrets. A database-writing fill filed under "eval" is a
 *     mislabel that costs the next reader more than this file does.
 *   - **`vitest.db.config.mts`.** It REFUSES any database not named `*_test` or
 *     `*_dbtest`, which is correct and is exactly why a real fill cannot ride on
 *     it. That guard exists because a real Neon endpoint was reset on 2026-09-18.
 *
 * ── NO `.env` READING HERE, DELIBERATELY ──
 *
 * The eval config reads `apps/web/.env` so a person need not put a secret on a
 * command line. This one does not, and the difference is the point: a task that
 * WRITES should take its target from the environment the operator set for that one
 * command, so the database being written to is visible in the thing they typed
 * rather than inherited from a file they last edited weeks ago. The task prints the
 * host it resolved before it does anything, and defaults to changing nothing.
 */

const here = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.task.ts"],
    exclude: ["node_modules/**", ".next/**"],
    /* One at a time: a task talks to one database and its output is meant to be
       read in order. */
    fileParallelism: false,
    /* A 77MB file and a few hundred UPDATEs. The default 5s is not enough and a
       task that dies halfway is worse than one that takes a minute. */
    testTimeout: 600_000,
  },
  resolve: { alias: { "@": here } },
});
