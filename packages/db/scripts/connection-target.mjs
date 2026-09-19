/**
 * Which database a connection string actually points at.
 *
 * Written because two people spent a day disagreeing about whether a
 * migration had been applied, and both were right: `prisma migrate deploy`
 * in the Vercel build reported success against one Neon endpoint while both
 * laptops were reading another. Nothing in the repo, the logs anyone
 * routinely reads, or CLAUDE.md said which endpoint anything was talking
 * to, so there was no way to notice.
 *
 * Everything here is pure and takes the connection string as an argument,
 * so it can be tested without a database and without secrets.
 *
 * NOTHING in this file returns a credential. `describe` deliberately
 * returns host and database name only — this output is written to build
 * logs, which are not private, and the connection strings carry passwords.
 */

/**
 * Neon gives one database branch two endpoints: a direct one and a pooled
 * one whose host is the same id with `-pooler` appended. Same database,
 * two doors. Stripping the suffix is what makes "are these the same
 * database?" answerable.
 */
function normaliseNeonHost(host) {
  return host.replace(/-pooler\./, ".");
}

/** The `ep-...` endpoint id, when this is a Neon host. Null otherwise. */
export function neonEndpointId(host) {
  const match = normaliseNeonHost(host).match(/^(ep-[a-z0-9-]+?)\./);
  return match ? match[1] : null;
}

export function isPooled(host) {
  return host.includes("-pooler.");
}

/**
 * Host, database name and whether it is pooled — parsed from a connection
 * string, with the credentials left behind.
 *
 * Returns null rather than throwing on an unparseable value: a missing or
 * malformed variable is a case the caller reports in its own words, and an
 * exception here would print a stack trace that could contain the string.
 */
export function describe(connectionString) {
  if (!connectionString) return null;
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    return null;
  }
  if (!url.hostname) return null;
  const database = url.pathname.replace(/^\//, "") || null;
  return {
    host: url.hostname,
    database,
    pooled: isPooled(url.hostname),
    endpointId: neonEndpointId(url.hostname),
    /** Safe to print: host and database only, never user:password. */
    label: `${url.hostname}/${database ?? "(no database named)"}`,
  };
}

/**
 * Do these two connection strings reach the same database?
 *
 * For Neon, same endpoint id after removing `-pooler` and same database
 * name. For anything else (a local Postgres, a CI stub) the host and
 * database name have to match outright — a local socket has no endpoint id
 * to compare, and guessing would make the check useless exactly where it
 * is cheapest to run.
 */
export function sameDatabase(a, b) {
  if (!a || !b) return false;
  if (a.database !== b.database) return false;
  if (a.endpointId && b.endpointId) return a.endpointId === b.endpointId;
  if (a.endpointId || b.endpointId) return false;
  return normaliseNeonHost(a.host) === normaliseNeonHost(b.host);
}

/**
 * Does this pair actually reach the database the operator NAMED?
 *
 * `connectionProblems` only asks whether the two URLs agree with EACH OTHER.
 * Two wrong-but-matching URLs pass it completely. That was tolerable while
 * both pointed at a long-established production database, and stopped being
 * tolerable the first time they pointed at a brand new empty one: `migrate
 * deploy` will happily build a plausible schema in a database nobody meant,
 * report success, and read back up to date. Every signal green and nothing
 * where it was supposed to go — the failure that cost two people a day, in
 * the situation where it is most likely. Cyrus found the gap; this is it.
 *
 * Identity is a different question from internal agreement, and it can only
 * be answered by a human naming the target INDEPENDENTLY of the secret that
 * supplies it. Deriving `expected` from the connection string would make
 * this a tautology that passes forever, which is worse than no check.
 *
 * Substring match on the host, so `ep-patient-lake` accepts both the direct
 * endpoint and its `-pooler` twin — they are the same database by design.
 * Returns null when `expected` is blank: the assertion is opt-in, because
 * production's migrate job predates it and silently breaking that to add a
 * guard would be a poor trade. That is a DECISION — no name was given, so
 * nothing was promised.
 *
 * Naming a target and having nothing to check it against is the opposite,
 * and it used to return null too (issue #182). A name was given, so a check
 * WAS promised, and answering "no problem" to an empty question is the one
 * failure shape this repo has paid for over and over: the guard that cannot
 * fail reads exactly like the guard that passed. It is fatal now.
 *
 * Reachability, stated rather than implied, because a fix for something
 * nobody can reach is worth less than it looks: as of 2026-09-12 the one
 * caller (`migrate-deploy.mjs`) already exits on a null target before it
 * gets here, and both workflows supply a name — `migrate.yml` hardcodes it,
 * `migrate-demo.yml` marks its input `required: true` and pre-validates the
 * shape. So this branch is UNREACHABLE today. It is fixed anyway because
 * what makes it unreachable is an invariant in the CALLER that nothing
 * states and nothing tests; a second caller, or a relaxed exit above, turns
 * the assertion vacuous with every check still green.
 */
export function wrongTarget(expected, ...targets) {
  const want = expected?.trim();
  if (!want) return null;
  const named = targets.filter(Boolean);
  if (named.length === 0) {
    return {
      level: "fatal",
      message:
        `you named "${want}" as the target, but NO connection string could be read,\n` +
        "db: so there is nothing to compare it against. Nothing has been applied.\n" +
        "db: This is not the same as the target being correct — the assertion you\n" +
        "db: asked for did not run. Fix DATABASE_URL and DIRECT_URL and re-run.",
    };
  }
  const missed = named.filter((t) => !t.host.includes(want));
  if (missed.length === 0) return null;
  return {
    level: "fatal",
    message:
      `you named "${want}" as the target, but this is pointing at\n` +
      missed.map((t) => `db:   ${t.label}`).join("\n") +
      "\ndb: Nothing has been applied. Either the secret holds the wrong connection\n" +
      "db: string or the name typed was wrong — both are worth knowing BEFORE a\n" +
      "db: migration runs, because afterwards both look like success.",
  };
}

/**
 * Is this a database the destructive test suite may touch? Local only.
 *
 * Added 2026-09-18, the day `prisma migrate diff --shadow-database-url`
 * was handed a real Neon endpoint and Prisma did what it documents: it
 * RESET the shadow database before replaying migrations into it. Cyrus's
 * dev database (ep-icy-hat) was dropped to nothing in the middle of him
 * walking the app. The dbtest suite creates and deletes companies, so it
 * carries the same risk wearing a test runner.
 *
 * Require a loopback host and an explicitly test-named database. A socket
 * override is allowed only when it is an absolute local path. Merely
 * appending a socket parameter must never whitelist a remote authority.
 * There is deliberately NO env-var escape hatch: the day somebody needs
 * one is the day this happens again.
 */
export function scratchProblem(connectionString, name) {
  const target = describe(connectionString);
  if (!target) return `${name} is missing or not a valid connection string, so there is nothing safe to run against.`;
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    return `${name} must be a PostgreSQL connection string for a local test database.`;
  }
  const local =
    target.host === "localhost" ||
    target.host === "127.0.0.1" ||
    target.host === "[::1]";
  if (!local) return `${name} is not a local database. The db suite creates and DELETES rows; use the scratch recipe in vitest.db.config.mts.`;
  const hosts = url.searchParams.getAll("host");
  if (hosts.length > 1 || hosts.some((host) => !host.startsWith("/") || host.startsWith("//")) ||
      url.searchParams.has("hostaddr") || url.searchParams.has("service")) {
    return `${name} contains an unsafe host override. Only one absolute local socket path is allowed.`;
  }
  if (!target.database || !/^[a-z0-9_]+_(?:test|dbtest)$/.test(target.database)) {
    return `${name} must name a disposable database ending in _test or _dbtest, not an application database.`;
  }
  return null;
}

/** Validate the application/migration pair without exposing credentials. */
export function connectionProblems(databaseUrl, directUrl) {
  const problems = [];
  const app = describe(databaseUrl);
  const migrate = describe(directUrl);

  if (!app) problems.push({ level: "fatal", message: "DATABASE_URL is missing or not a valid connection string." });
  if (!migrate) problems.push({ level: "fatal", message: "DIRECT_URL is missing or not a valid connection string." });
  if (!app || !migrate) return { app, migrate, problems };

  if (!sameDatabase(app, migrate)) {
    problems.push({
      level: "fatal",
      message:
        `DATABASE_URL and DIRECT_URL point at DIFFERENT databases.\n` +
        `  the app queries:      ${app.label}\n` +
        `  migrations would run: ${migrate.label}\n` +
        `Migrations would be applied where the app will never read them. ` +
        `Both must be the same Neon branch — DIRECT_URL is its direct endpoint, ` +
        `DATABASE_URL its -pooler one.`,
    });
  }

  if (migrate.pooled) {
    problems.push({
      level: "fatal",
      message:
        `DIRECT_URL is a pooled endpoint (${migrate.label}). ` +
        `prisma migrate takes session-level advisory locks a connection pooler cannot hold. ` +
        `Use the direct endpoint — the same host without "-pooler".`,
    });
  }

  if (app.endpointId && !app.pooled) {
    problems.push({
      level: "warning",
      message:
        `DATABASE_URL is the direct endpoint (${app.label}), not the pooled one. ` +
        `It works, but serverless opens a connection per invocation — use the "-pooler" host.`,
    });
  }

  return { app, migrate, problems };
}
