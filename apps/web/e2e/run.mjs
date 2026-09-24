#!/usr/bin/env node
/**
 * ONE COMMAND THAT DRIVES THE PRODUCT THROUGH A REAL BROWSER, against a
 * database that did not exist a minute ago and will not exist a minute
 * after.
 *
 *   pnpm test:e2e              (from the repo root)
 *   pnpm test:e2e -- --skip-build          reuse the last `next build`
 *   pnpm test:e2e -- specs/journey.spec.ts any other Playwright args
 *
 *   pnpm test:e2e:public       NO CLERK INSTANCE NEEDED — every page
 *                              reachable without signing in, at 320, 375
 *                              and a 1280 control
 *     (e2e/playwright.public.config.ts. This mode reads no .env at all and
 *      forces a placeholder Clerk key over anything in the environment, so
 *      it cannot quietly start depending on a real instance. It is what
 *      .github/workflows/ci.yml's `e2e-public` job runs, with no secrets.
 *      That job named e2e.yml here for three days and no such workflow has
 *      ever existed in this repository — two PRs had their workflow push
 *      rejected for want of the `workflow` scope and left the job in their
 *      PR bodies, so the file every reader was pointed at was never there.)
 *
 * What it does, in order, and why each step is where it is:
 *
 *   1. Reads ONLY the Clerk keys out of apps/web/.env (the DEVELOPMENT
 *      instance's `pk_test_`/`sk_test_`), and refuses a production
 *      (`_live_`) key before anything else happens. It never reads
 *      DATABASE_URL, DIRECT_URL or BLOB_READ_WRITE_TOKEN from that file —
 *      a connection string's presence in an env file means something real
 *      lives there, which is what disqualifies it (CLAUDE.md, the
 *      shadow-database entry).
 *   2. Starts a THROWAWAY Postgres 16 (embedded-postgres, a dev
 *      dependency — this machine has no Postgres and no Docker) on
 *      127.0.0.1, a free port, a random password, a data directory under
 *      the OS temp dir, and creates `prova_e2e_test` in it. The name is
 *      load-bearing: `scratchProblem()` in
 *      packages/db/scripts/connection-target.mjs — the SAME guard the db
 *      suite and the Playwright config run — accepts only a loopback host
 *      and a `_test`/`_dbtest` database, and this script asserts its own
 *      URL through that guard before handing it to anything.
 *   3. Applies every committed migration to it (`prisma migrate deploy`),
 *      so the schema under test is the one a PR would ship.
 *   4. Builds the app the way production runs it (`next build`), with the
 *      scratch URL and a FAKE blob token in the environment, so nothing
 *      the build inlines can name a real resource.
 *   5. Runs Playwright, whose config re-checks the database guard at load
 *      and starts `next start` itself with the same environment.
 *   6. Stops Postgres and deletes its directory, whatever happened above,
 *      and exits with Playwright's exit code — checked as a CODE, never
 *      read off the tail of the output.
 *
 * Set E2E_DATABASE_URL to use a Postgres you already run instead of the
 * embedded one. It goes through the same guard, so it still has to be
 * local and end in `_test`; there is no way to point this at anything
 * else, by design.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { describe, scratchProblem } from "../../../packages/db/scripts/connection-target.mjs";
import { E2E_FAKE_BLOB_TOKEN } from "./lib/fakeBlobToken.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const repoRoot = path.resolve(webRoot, "../..");
const dbPackage = path.join(repoRoot, "packages/db");
const DB_NAME = "prova_e2e_test";

const log = (line) => process.stdout.write(`[e2e] ${line}\n`);
const fail = (line) => {
  process.stderr.write(`[e2e] ${line}\n`);
  process.exit(1);
};

// ---------------------------------------------------------------- arguments
// `pnpm test:e2e -- --skip-build` reaches this script as
// `node e2e/run.mjs -- --skip-build`: pnpm forwards the separator itself.
// A bare `--` means nothing to Playwright and is dropped.
const argv = process.argv.slice(2).filter((arg) => arg !== "--");
const skipBuild = argv.includes("--skip-build") || process.env.E2E_SKIP_BUILD === "1";
/**
 * `--public` runs ONLY the half of the suite that needs no Clerk instance
 * (e2e/playwright.public.config.ts) — every page reachable without signing
 * in, at 320, 375 and a 1280 control.
 *
 * It does not merely skip the Clerk keys, it REFUSES to use any: the
 * placeholders below are forced over whatever is in the environment or in
 * apps/web/.env. A mode whose whole claim is "this needs no credentials"
 * must not be able to quietly pick one up and start depending on it — and
 * this is the mode CI runs with no secrets at all.
 */
const publicOnly = argv.includes("--public") || process.env.E2E_PUBLIC_ONLY === "1";
const playwrightArgs = argv.filter((arg) => arg !== "--skip-build" && arg !== "--public");

// ------------------------------------------------------------- Clerk keys
/** Minimal .env reader: KEY=value, optional quotes, comments ignored. */
function readDotenv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = raw.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

const CLERK_KEYS = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
  "NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL",
];

// In --public mode apps/web/.env is not read AT ALL. The placeholders are
// the ones ci.yml already commits to this repository — a publishable key
// whose Frontend API domain is `clerk.example.com`, which resolves nowhere.
// That is the point: if any part of the public suite ever started needing a
// real Clerk instance, it would fail here rather than silently borrow the
// developer's own.
const dotenv = publicOnly ? {} : readDotenv(path.join(webRoot, ".env"));
const clerk = {};
if (publicOnly) {
  clerk.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";
  clerk.CLERK_SECRET_KEY = "sk_test_dummydummydummydummydummydummydummydummy";
} else {
  for (const key of CLERK_KEYS) {
    const value = process.env[key] ?? dotenv[key];
    if (value) clerk[key] = value;
  }
}
if (!clerk.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !clerk.CLERK_SECRET_KEY) {
  fail(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY were not found in the environment or apps/web/.env.\n" +
      "[e2e] The suite signs real Clerk test users in on the DEVELOPMENT instance; it needs that instance's keys.",
  );
}
if (clerk.CLERK_SECRET_KEY.startsWith("sk_live_") || clerk.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.startsWith("pk_live_")) {
  fail("refusing to run: the Clerk keys are PRODUCTION (_live_) keys. This suite mints test users; it runs only against a development instance.");
}
clerk.NEXT_PUBLIC_CLERK_SIGN_IN_URL ??= "/sign-in";
clerk.NEXT_PUBLIC_CLERK_SIGN_UP_URL ??= "/sign-up";
clerk.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL ??= "/dashboard";
clerk.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL ??= "/dashboard";
log(
  publicOnly
    ? "clerk: NONE — --public forces a placeholder key and reads no .env; no Clerk API is contacted and no user is minted."
    : `clerk: ${clerk.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.slice(0, 8)}… (development instance)`,
);

// ---------------------------------------------------------------- database
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

let postgres = null;
let dataDir = null;
let databaseUrl = process.env.E2E_DATABASE_URL ?? null;

async function startEmbeddedPostgres() {
  const port = await freePort();
  const password = randomBytes(12).toString("hex");
  dataDir = mkdtempSync(path.join(tmpdir(), "prova-e2e-pg-"));
  postgres = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password,
    port,
    persistent: false,
    onLog: () => {},
    onError: (message) => process.stderr.write(`[postgres] ${String(message)}`),
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(DB_NAME);
  return `postgresql://postgres:${password}@127.0.0.1:${port}/${DB_NAME}`;
}

async function stopEmbeddedPostgres() {
  if (postgres) {
    try {
      await postgres.stop();
    } catch (error) {
      process.stderr.write(`[e2e] postgres did not stop cleanly: ${String(error)}\n`);
    }
    postgres = null;
  }
  if (dataDir) {
    rmSync(dataDir, { recursive: true, force: true });
    dataDir = null;
  }
}

// ---------------------------------------------------------------- children
let child = null;
function run(command, args, options) {
  return new Promise((resolve) => {
    child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", (error) => {
      process.stderr.write(`[e2e] could not start ${command}: ${String(error)}\n`);
      resolve(1);
    });
    child.once("exit", (code, signal) => {
      child = null;
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted = true;
    if (child) child.kill(signal);
  });
}

// -------------------------------------------------------------------- main
let exitCode = 1;
try {
  if (databaseUrl) {
    log("database: using E2E_DATABASE_URL");
  } else {
    log("database: starting a throwaway embedded Postgres 16…");
    databaseUrl = await startEmbeddedPostgres();
  }

  // The same guard the db suite and the Playwright config apply, applied
  // to the URL this script itself just built. It cannot fail unless the
  // guard changed, and that is exactly when it should.
  for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
    const problem = scratchProblem(databaseUrl, name);
    if (problem) fail(`refusing to run: ${problem}`);
  }
  log(`database: ${describe(databaseUrl).label} (loopback, throwaway — passes scratchProblem())`);

  const env = { ...process.env };
  // Nothing real leaks into the children through inheritance.
  for (const key of ["DATABASE_URL", "DIRECT_URL", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID", "ANTHROPIC_API_KEY", "E2E_DATABASE_URL"]) {
    delete env[key];
  }
  Object.assign(env, clerk, {
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    BLOB_READ_WRITE_TOKEN: E2E_FAKE_BLOB_TOKEN,
    ANTHROPIC_API_KEY: "",
    E2E_RUNNER: "1",
  });

  log("migrations: prisma migrate deploy against the throwaway database…");
  exitCode = await run("pnpm", ["exec", "prisma", "migrate", "deploy", "--schema", "prisma/schema"], { cwd: dbPackage, env });
  if (exitCode !== 0) throw new Error(`prisma migrate deploy exited ${exitCode}`);

  const buildId = path.join(webRoot, ".next", "BUILD_ID");
  if (skipBuild && existsSync(buildId)) {
    log(`build: REUSING apps/web/.next (BUILD_ID ${readFileSync(buildId, "utf8").trim()}) — --skip-build was passed; this build may predate your change.`);
  } else {
    if (skipBuild) log("build: --skip-build was passed but there is no previous build; building.");
    log("build: next build (production build, the way the app actually runs). This takes a few minutes.");
    log("build: NOTE — `next build` and `next dev` share apps/web/.next. If a dev server is running from THIS checkout, it will start 500ing until you restart it (CLAUDE.md).");
    exitCode = await run("pnpm", ["exec", "next", "build"], { cwd: webRoot, env });
    if (exitCode !== 0) throw new Error(`next build exited ${exitCode}`);
  }

  const config = publicOnly ? "e2e/playwright.public.config.ts" : "e2e/playwright.config.ts";
  log(`playwright: driving the browser (${config})…`);
  exitCode = await run("pnpm", ["exec", "playwright", "test", "--config", config, ...playwrightArgs], {
    cwd: webRoot,
    env,
  });
  log(`playwright exited ${exitCode}${exitCode === 0 ? " — every step passed" : " — see the output above and apps/web/playwright-report/index.html"}`);
} catch (error) {
  if (!interrupted) process.stderr.write(`[e2e] ${error instanceof Error ? error.message : String(error)}\n`);
  if (exitCode === 0) exitCode = 1;
} finally {
  await stopEmbeddedPostgres();
  log("database: stopped and deleted.");
}

process.exit(interrupted ? 130 : exitCode);
