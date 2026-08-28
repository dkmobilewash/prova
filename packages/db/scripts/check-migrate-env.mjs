// Preflight for `prisma migrate deploy`.
//
// Prisma resolves the datasource's env() calls while *loading* the schema, so
// a missing DIRECT_URL fails with a bare P1012 pointing at a line of
// schema.prisma:
//
//     error: Environment variable not found: DIRECT_URL.
//       -->  prisma/schema/schema.prisma:22
//
// which reads like a schema bug rather than "this variable isn't set on this
// deployment." On Vercel that distinction is the whole problem: an
// environment variable added to Production only is absent from Preview
// builds, and every push to a branch that isn't the project's production
// branch builds as a Preview — `main` included, on this project. So the
// build that fails is not the one you set the variable for.
//
// Checking first turns that into a message that names the missing variable
// and where to put it.

const REQUIRED = {
  DATABASE_URL:
    "the pooled Neon connection string — what the app queries through",
  DIRECT_URL:
    "the direct (unpooled) Neon connection string — `prisma migrate` takes " +
    "session-level advisory locks a connection pooler can't hold, which is " +
    "why this is a second variable and not just DATABASE_URL",
};

const missing = Object.keys(REQUIRED).filter((name) => !process.env[name]);

if (missing.length > 0) {
  const lines = [
    `Cannot run 'prisma migrate deploy': ${missing.join(" and ")} not set.`,
    "",
    ...missing.map((name) => `  ${name} — ${REQUIRED[name]}`),
    "",
    "Both connection strings are on the Neon dashboard under Connect, and",
    "both must be set on *every* Vercel environment this build runs in —",
    "Production and Preview — not just Production. Vercel project settings →",
    "Environment Variables, tick every environment, then redeploy.",
  ];

  console.error(lines.join("\n"));
  process.exit(1);
}
