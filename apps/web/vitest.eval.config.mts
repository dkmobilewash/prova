import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The routing eval: real model, real prompt, no database. Kept out of the
 * unit config (which must run in a second with nothing but Node) and out
 * of the db config (which must not spend money) for the same reason both
 * of those exist — a suite that needs something it might not have is a
 * suite that gets skipped and then quietly rots. This one is run by hand,
 * before a prompt or model change, by whoever has a key.
 *
 * THE KEY IS READ FROM `apps/web/.env` AS WELL AS FROM THE SHELL, and that is not
 * a convenience. Putting a ~100-character secret on a command line in front of a
 * long pnpm invocation produced `zsh: command not found: --filter` and then
 * `zsh: command not found: eval:addenda` on two consecutive attempts, because a
 * newline landed in the paste and the shell ran the first word on its own. The
 * person hitting that is not doing anything wrong — the instruction is.
 *
 * `.env` is where this repo already keeps `DATABASE_URL` and the Clerk keys, it is
 * gitignored, and editing a file involves no shell quoting at all. So the key is
 * pasted once, into a text editor, and every run afterwards is a short command
 * with no secret on it.
 *
 * A REAL ENVIRONMENT VARIABLE STILL WINS: vitest merges `test.env` underneath
 * `process.env`, so CI and a deliberate one-off override are unchanged, and a
 * stale key in a file cannot silently beat the one somebody just exported.
 *
 * It refuses to run without the key rather than passing on nothing.
 */

const here = fileURLToPath(new URL("./", import.meta.url));

/**
 * `apps/web/.env`, read by hand.
 *
 * THREE THINGS IT IS NOT, each tried first and each worse. Vite's `loadEnv` is
 * the obvious answer and `vite` is not a direct dependency of this workspace, so
 * importing it fails at config load. `vitest/config` does not re-export it.
 * `process.loadEnvFile` exists on Node 26 here but arrived in 20.12, and this
 * repo's `engines` allow 20 — and it would leave me trusting its precedence
 * rules rather than stating them.
 *
 * So: ten lines, no dependency, no lockfile change, and precedence that is
 * visible on the page. A REAL ENVIRONMENT VARIABLE ALWAYS WINS — keys already in
 * `process.env` are never replaced, so exporting one for a single run beats a
 * stale value in a file, and CI is untouched because it sets its own and has no
 * `.env` at all.
 *
 * Deliberately forgiving about the file: absent is the normal case for anybody
 * who exports the key instead, and an unparseable line is skipped rather than
 * thrown on, because the eval's own guard gives a far better message about a
 * missing key than a config-load stack trace does.
 */
function envFile(): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(new URL(".env", import.meta.url), "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const at = trimmed.indexOf("=");
    if (at <= 0) continue;
    const name = trimmed.slice(0, at).trim();
    if (name in process.env) continue;
    // Quotes stripped, because a `.env` written by hand often has them and the
    // value is a secret whose surrounding quotes are not part of it.
    out[name] = trimmed.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

export default defineConfig({
  test: {
    environment: "node",
    // Whatever `.env` holds that the shell has not already set. No prefix
    // filter: these run in Node and none of it reaches a browser.
    env: envFile(),
    include: ["**/*.eval.ts"],
    exclude: ["node_modules/**", ".next/**"],
    // One case at a time, so the per-case verdicts read in order and a
    // rate limit hits one request rather than forty.
    fileParallelism: false,
    testTimeout: 90_000,
  },
  resolve: {
    alias: {
      "@": here,
    },
  },
});
