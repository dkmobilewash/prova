import { spawnSync } from "node:child_process";

/**
 * The migrate step of the Vercel build.
 *
 * There is ONE Neon database. Without a gate here, every push to every
 * branch migrates production: a preview build runs the same build command a
 * production build does, so an unmerged feature branch changes the live
 * schema the moment it is pushed. That is not theoretical — add_submittals,
 * add_change_order_lifecycle and add_change_order_reopen_and_revision all
 * reached production from preview builds of branches whose PRs had not
 * merged.
 *
 * So: only a production deployment migrates.
 *
 * The cost is real and worth stating. A preview of a branch that adds a
 * model now runs against a database without those tables, so pages using
 * them will fail until the branch merges. That matters in a project whose
 * first rule is to verify by clicking, which is why the override below
 * exists — and why per-preview database branching (Neon's own feature,
 * wired through the Vercel integration) is the actual fix. This gate stops
 * the bleeding; it isn't the destination.
 *
 * ALLOW_PREVIEW_MIGRATIONS=true re-enables migration for one deployment.
 * Set it on a single preview branch in Vercel's environment variables when
 * you genuinely need that branch's schema live to test it, and take it off
 * afterwards. It is deliberately opt-in and deliberately noisy in the log:
 * the point is that migrating production from a branch becomes a decision
 * someone made, not a thing that happens by default.
 */

const vercelEnv = process.env.VERCEL_ENV ?? "";
const allowPreview = process.env.ALLOW_PREVIEW_MIGRATIONS === "true";
const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "(unknown branch)";

// No VERCEL_ENV means this isn't a Vercel build — someone ran it locally or
// in CI, where the target database is theirs to migrate.
if (vercelEnv && vercelEnv !== "production") {
  if (!allowPreview) {
    console.log(
      [
        `migrate: skipped — this is a ${vercelEnv} deployment of "${branch}", not production.`,
        "migrate: previews share the production database, so migrating here would change",
        "migrate: the live schema from a branch that hasn't merged.",
        "migrate: pages relying on new tables will fail on this preview until it merges.",
        "migrate: to migrate from this branch anyway, set ALLOW_PREVIEW_MIGRATIONS=true on it",
        "migrate: in Vercel's environment variables, and remove it once you're done.",
      ].join("\n"),
    );
    process.exit(0);
  }
  console.log(
    `migrate: ALLOW_PREVIEW_MIGRATIONS is set — migrating PRODUCTION from ${vercelEnv} branch "${branch}".`,
  );
}

/**
 * Prisma resolves the datasource's env() calls while *loading* the schema,
 * so a missing DIRECT_URL fails with a bare P1012 pointing at a line of
 * schema.prisma, which reads like a schema bug rather than an unset
 * variable. On Vercel that distinction is the whole problem: a variable set
 * on Production only is absent from Preview builds.
 */
const REQUIRED = {
  DATABASE_URL: "the pooled Neon connection string — what the app queries through",
  DIRECT_URL:
    "the direct (unpooled) Neon connection string — `prisma migrate` takes " +
    "session-level advisory locks a connection pooler can't hold, which is " +
    "why this is a second variable and not just DATABASE_URL",
};

const missing = Object.keys(REQUIRED).filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(
    [
      `Cannot run 'prisma migrate deploy': ${missing.join(" and ")} not set.`,
      "",
      ...missing.map((name) => `  ${name} — ${REQUIRED[name]}`),
      "",
      "Both connection strings are on the Neon dashboard under Connect, and",
      "both must be set on *every* Vercel environment this build runs in —",
      "Production and Preview — not just Production. Vercel project settings →",
      "Environment Variables, tick every environment, then redeploy.",
    ].join("\n"),
  );
  process.exit(1);
}

// Via `pnpm exec` rather than a bare `prisma`: this script is invoked by
// `node`, which does not put node_modules/.bin on PATH the way a package
// script does, so calling the binary directly exits 127 outside a pnpm
// context. pnpm resolves it from the workspace.
const result = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { stdio: "inherit" });
if (result.error) {
  console.error(`Could not run 'prisma migrate deploy': ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
