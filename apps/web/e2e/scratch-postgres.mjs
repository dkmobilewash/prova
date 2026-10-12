#!/usr/bin/env node
/**
 * RUN A COMMAND AGAINST A THROWAWAY POSTGRES, WITH NO DOCKER.
 *
 * ── WHY THIS EXISTS ──
 *
 * `dbtest` used a `postgres:16` SERVICE CONTAINER, and on 2026-10-09 every run
 * of it failed on Docker Hub's anonymous pull cap:
 *
 *     toomanyrequests: You have reached your unauthenticated pull rate limit
 *
 * Three jobs died on it, a re-run hit the same wall, and the cap is on GitHub's
 * shared runner IPs rather than on anything this repo controls — so it blocks
 * every PR and waiting it out is not a plan. The two fixes are to authenticate
 * the pull (a Docker Hub account and two repository secrets, to keep using a
 * registry we do not need) or to stop pulling an image at all.
 *
 * This is the second. `embedded-postgres` is already a dependency of this
 * workspace and already how `run.mjs` boots the database for the whole e2e
 * journey, so the capability was here the whole time — `dbtest` was the one
 * job still reaching for a registry.
 *
 * ── WHAT IT DOES ──
 *
 *     node e2e/scratch-postgres.mjs "<command>" ["<command>" …]
 *
 * Boots a Postgres that lives in a temp directory and dies with this process,
 * puts its URL in `DATABASE_URL` and `DIRECT_URL`, runs each command in order
 * through the shell, and stops at the first one that fails. The exit code is
 * the first failing command's, so CI reads it exactly as it read the old
 * steps.
 *
 * ── THE DATABASE NAME IS LOAD-BEARING ──
 *
 * `scratchProblem()` in `packages/db/scripts/connection-target.mjs` accepts
 * only a loopback host and a name ending `_test`/`_dbtest`, with deliberately
 * no env-var escape hatch — it is what stops this suite ever running against a
 * real database, after a real Neon endpoint was reset on 2026-09-18. A random
 * port and a random password are fine; the NAME is not free, and `_dbtest`
 * here is the same name the service container used.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const DB_NAME = "prova_dbtest";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const commands = process.argv.slice(2);
if (commands.length === 0) {
  process.stderr.write("usage: node e2e/scratch-postgres.mjs \"<command>\" [\"<command>\" …]\n");
  process.exit(2);
}

/** A port the OS says is free, so two jobs on one runner cannot collide — the
 *  fixed 5432 of a service container is exactly what makes that possible. */
const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const port = await freePort();
const password = randomBytes(12).toString("hex");
const dataDir = mkdtempSync(path.join(tmpdir(), "prova-scratch-pg-"));
const postgres = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password,
  port,
  persistent: false,
  onLog: () => {},
  onError: (message) => process.stderr.write(`[postgres] ${String(message)}`),
});

let code = 1;
try {
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(DB_NAME);
  // The password is a throwaway generated a few lines up and the database dies
  // with this process, but the URL still never goes to stdout: a log line is a
  // habit, and the next person to copy this file may not have a disposable one.
  console.log(`[scratch-postgres] up on 127.0.0.1:${port}/${DB_NAME}`);

  const env = {
    ...process.env,
    DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/${DB_NAME}`,
    DIRECT_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/${DB_NAME}`,
  };

  code = 0;
  for (const command of commands) {
    console.log(`[scratch-postgres] ${command}`);
    const result = spawnSync(command, { cwd: repoRoot, env, shell: true, stdio: "inherit" });
    // A command killed by a signal reports `status: null`, which `?? 1` would
    // quietly turn into an ordinary failure. It is still a failure either way,
    // but the distinction is worth not losing in a harness.
    code = result.status ?? (result.signal ? 1 : 1);
    if (code !== 0) {
      console.error(`[scratch-postgres] FAILED (${result.signal ?? code}): ${command}`);
      break;
    }
  }
} finally {
  try {
    await postgres.stop();
  } catch {
    // Already down, or never came up. Nothing here is worth failing a run over
    // — the data directory goes next either way.
  }
  rmSync(dataDir, { recursive: true, force: true });
}

process.exit(code);
