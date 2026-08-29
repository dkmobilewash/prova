import { spawnSync } from "node:child_process";
import { connectionProblems } from "./connection-target.mjs";

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
      "db: how the schema and the code silently drift apart. Fix the secrets on\n" +
      "db: this repository (Settings → Secrets and variables → Actions) and re-run.",
  );
  process.exit(1);
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
