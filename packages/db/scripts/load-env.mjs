import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads a .env file into process.env, for scripts that run under plain
 * `node` rather than through the Prisma CLI.
 *
 * This exists because of a real hole. `prisma migrate dev` reads .env
 * because the PRISMA CLI does that itself — it is not a Node feature. Our
 * own scripts run as `node scripts/*.mjs` and so saw none of it: on a
 * developer machine DATABASE_URL was simply undefined, and migrate-deploy
 * exited telling the developer to go and fix this repository's GitHub
 * Actions secrets. That advice is right in CI and useless on a laptop,
 * where the answer is a file sitting in this very folder.
 *
 * Never overrides a variable that is already set. CI passes real secrets
 * as environment variables, and a stray .env in a runner's checkout must
 * not be able to redirect a migration to another database. Set beats file,
 * always.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** In precedence order. The first file to define a variable wins, and
 * anything already in the environment beats all of them. */
export const CANDIDATE_ENV_FILES = [
  join(here, "..", ".env"), // packages/db/.env — where Prisma looks
  join(here, "..", "prisma", ".env"), // packages/db/prisma/.env
  join(here, "..", "..", "..", ".env"), // repo root
];

/** Parses .env text into pairs.
 *
 * Deliberately small, and deliberately not a regex over the whole file: a
 * connection string is full of `=`, `?`, `&` and `#`, and a parser that
 * splits on the wrong one produces a URL that is subtly wrong rather than
 * absent — which is the failure that is hard to see.
 */
export function parseEnv(text) {
  const out = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq < 1) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      // Quoted: take it whole. A `#` inside quotes is part of a password,
      // not a comment.
      value = value.slice(1, -1);
    } else {
      // Unquoted: an inline comment needs whitespace before the `#`, so a
      // fragment like `?options=#foo` survives.
      const hash = value.search(/\s#/);
      if (hash !== -1) value = value.slice(0, hash).trimEnd();
    }
    if (!out.has(key)) out.set(key, value);
  }
  return out;
}

/** Fills in unset variables from the first candidate file that exists.
 * Returns the files it read, for reporting — never the values. */
export function loadEnvFiles(files = CANDIDATE_ENV_FILES, env = process.env) {
  const loaded = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    let parsed;
    try {
      parsed = parseEnv(readFileSync(file, "utf8"));
    } catch {
      continue; // unreadable is the same as absent
    }
    let applied = 0;
    for (const [key, value] of parsed) {
      if (env[key] === undefined || env[key] === "") {
        env[key] = value;
        applied += 1;
      }
    }
    loaded.push({ file: resolve(file), applied });
  }
  return loaded;
}
