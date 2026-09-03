import { spawnSync } from "node:child_process";
import { connectionProblems, wrongTarget } from "./connection-target.mjs";
import { loadEnvFiles } from "./load-env.mjs";

/**
 * Applies pending migrations. Run by CI on merge to main — not by a build.
 *
 * It used to run inside the Vercel build, gated to production deployments.
 * That gate was correct about previews and blind to promotion: promoting a
 * preview to production reuses the preview's already-built output, so the
 * build command never re-runs and no migration is ever applied. A
 * deployment could become production carrying code whose migrations had
 * never run.
 *
 * Tying this to the merge instead fixes that and says something truer:
 * merging is the decision to change production. A build is not.
 *
 * The connection check below runs first because the incident that prompted
 * all of this was not a migration failing — it was a migration succeeding,
 * loudly and repeatedly, against a database nobody was reading.
 */

// Under plain `node`, nothing reads .env — that is the Prisma CLI's doing,
// not Node's, so this script never saw a developer's local settings and
// told them to go and fix GitHub Actions secrets instead. Already-set
// variables always win, so CI is untouched by any .env in its checkout.
const envFiles = loadEnvFiles();
const inCI = Boolean(process.env.CI);
for (const { file, applied } of envFiles) {
  if (applied > 0) console.log(`db: read ${applied} setting(s) from ${file}`);
}

const { app, migrate, problems } = connectionProblems(
  process.env.DATABASE_URL,
  process.env.DIRECT_URL,
);

console.log(`db: app queries      ${app?.label ?? "(DATABASE_URL unreadable)"}`);
console.log(`db: applying to      ${migrate?.label ?? "(DIRECT_URL unreadable)"}`);

for (const problem of problems) {
  console[problem.level === "fatal" ? "error" : "warn"](
    `db: ${problem.level === "fatal" ? "FATAL" : "warning"} — ${problem.message}`,
  );
}
if (problems.some((p) => p.level === "fatal")) {
  console.error(
    "\ndb: refusing to migrate. Applying to a database the app does not read is\n" +
      "db: how the schema and the code silently drift apart.",
  );
  // The fix is in a different place depending on where this is running, and
  // naming the wrong one costs someone an afternoon in the wrong settings
  // page. This script used to name the CI one unconditionally.
  console.error(
    inCI
      ? "db: Fix the secrets on this repository (Settings → Secrets and variables\n" +
          "db: → Actions) and re-run."
      : `db: Set DATABASE_URL and DIRECT_URL in ${envFiles[0]?.file ?? "packages/db/.env"}\n` +
          "db: (DATABASE_URL is the pooled endpoint, DIRECT_URL the direct one),\n" +
          "db: or export them into this shell, and re-run.",
  );
  process.exit(1);
}

/**
 * Then: is this the database you SAID you meant?
 *
 * Everything above checks the two URLs against each other. This checks them
 * against a name a person typed, which is the only way to catch a secret
 * holding the wrong connection string. Opt-in via MIGRATE_EXPECT_HOST so
 * production's job, which predates it, is unaffected until someone wires it
 * up deliberately.
 */
const misnamed = wrongTarget(process.env.MIGRATE_EXPECT_HOST, app, migrate);
if (misnamed) {
  console.error(`\ndb: REFUSING — ${misnamed.message}`);
  process.exit(1);
}
if (process.env.MIGRATE_EXPECT_HOST?.trim()) {
  console.log(`db: target matches   "${process.env.MIGRATE_EXPECT_HOST.trim()}" \u2713`);
}

const run = (args) => spawnSync("pnpm", ["exec", "prisma", ...args], { stdio: "inherit" });

const deploy = run(["migrate", "deploy"]);
if (deploy.error) {
  console.error(`db: could not run 'prisma migrate deploy': ${deploy.error.message}`);
  process.exit(1);
}
if (deploy.status !== 0) process.exit(deploy.status ?? 1);

/**
 * Assert, rather than trust the exit code above.
 *
 * This is the whole lesson of the incident: `migrate deploy` printed "All
 * migrations have been successfully applied" and the migration was not in
 * the database anyone read. A separate read-back, against the same
 * connection, in the same run, is cheap — and it is the difference between
 * a claim and a result.
 */
console.log("\ndb: verifying the database now reports itself up to date…");
const status = run(["migrate", "status"]);
if (status.status !== 0) {
  console.error(
    "\ndb: 'migrate deploy' reported success but 'migrate status' still reports\n" +
      "db: pending migrations on the same connection. Do not assume the deploy\n" +
      "db: worked. Check which database this actually reached — the hosts are\n" +
      "db: printed at the top of this log.",
  );
  process.exit(1);
}
console.log("db: verified — every migration in this commit is applied.");
