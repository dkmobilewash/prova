import { spawnSync } from "node:child_process";
import { connectionProblems } from "./connection-target.mjs";

/**
 * The database check that runs in the Vercel build. It no longer MIGRATES.
 *
 * Migrations moved to .github/workflows/migrate.yml, which runs on merge to
 * main. Two reasons, both learned the hard way:
 *
 * A promoted preview reuses the preview's build output, so the build
 * command never re-runs — a migration in a promoted deployment would never
 * be applied, and the gate that was supposed to prevent exactly this could
 * not see that door at all. Tying migration to the merge instead of to
 * whichever artifact becomes production closes it.
 *
 * And a build that migrates is a build that changes the database whether or
 * not the deploy it belongs to ever ships. Merging is the decision; a build
 * is not.
 *
 * What runs here now is the check that would have caught the incident this
 * was written after: `prisma migrate deploy` reported success in the build
 * for hours while both developers read a different Neon endpoint, because
 * DATABASE_URL and DIRECT_URL had drifted onto different databases and
 * nothing printed either host.
 */

const vercelEnv = process.env.VERCEL_ENV ?? "";
const isProduction = vercelEnv === "production";
const where = vercelEnv || "local";

const { app, migrate, problems } = connectionProblems(
  process.env.DATABASE_URL,
  process.env.DIRECT_URL,
);

// Printed on EVERY build, passing or failing. The whole incident was
// possible because nothing in a log anyone reads named the database.
console.log(`db: ${where} build`);
console.log(`db: app queries      ${app?.label ?? "(DATABASE_URL unreadable)"}`);
console.log(`db: migrations apply ${migrate?.label ?? "(DIRECT_URL unreadable)"}`);

const fatal = problems.filter((p) => p.level === "fatal");
for (const problem of problems) {
  console[problem.level === "fatal" ? "error" : "warn"](
    `db: ${problem.level === "fatal" ? "FATAL" : "warning"} — ${problem.message}`,
  );
}
if (fatal.length > 0) {
  console.error(
    "\ndb: refusing to build. Fix these in Vercel → Settings → Environment Variables,\n" +
      "db: on every environment this builds in (Production AND Preview), then redeploy.",
  );
  process.exit(1);
}

/**
 * Is the database this deployment will read actually carrying the
 * migrations this code expects?
 *
 * `migrate status` exits non-zero when migrations are pending. On a
 * production build that is a stop: shipping code that reads a column the
 * database doesn't have is a 500 on a real user's screen. On a preview it
 * is expected and normal — a branch adding a migration has not merged yet,
 * so CI has not applied it — and failing there would block the very
 * clicking that catches these bugs.
 */
const status = spawnSync("pnpm", ["exec", "prisma", "migrate", "status"], {
  encoding: "utf8",
});
const output = `${status.stdout ?? ""}${status.stderr ?? ""}`;
process.stdout.write(output);

const pending = status.status !== 0;
if (!pending) {
  console.log("db: schema is up to date with this commit's migrations.");
  process.exit(0);
}

if (!isProduction) {
  console.warn(
    [
      "",
      `db: migrations are pending on ${app?.label ?? "this database"}, which is EXPECTED on a ${where}.`,
      "db: they are applied by CI when the PR merges, not by this build.",
      "db: pages that read new tables or columns will fail on this preview until then.",
      "db: to verify by clicking before merging, apply them yourself against this",
      "db: database and re-deploy — see .github/workflows/migrate.yml for the command.",
    ].join("\n"),
  );
  process.exit(0);
}

console.error(
  [
    "",
    "db: refusing to build a PRODUCTION deployment against a database that is",
    "db: missing this commit's migrations. The code would read columns that do",
    "db: not exist and 500 on a real user.",
    "",
    "db: Migrations are applied by .github/workflows/migrate.yml on push to main.",
    "db: If that workflow did not run or failed, fix it there — do not migrate by",
    "db: hand to get this build through, or the two will disagree again.",
  ].join("\n"),
);
process.exit(1);
