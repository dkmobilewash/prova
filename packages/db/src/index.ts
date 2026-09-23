import { PrismaClient } from "@prisma/client";
import { markSchemaDrift } from "./schema-drift";

/**
 * The client, with ONE query hook: a Prisma "table/column does not exist"
 * error (P2021/P2022) gets a `SCHEMA_DRIFT_*` digest before Next.js ever
 * sees it, so the browser's error boundary can name schema drift when it
 * is drift and stay quiet about migrations when it is not. See
 * ./schema-drift.ts for why a digest is the only thing that survives
 * production's redaction, and components/PageLoadError.tsx (apps/web) for
 * what reads it. Every other error is rethrown untouched.
 *
 * `$allOperations` at the top level of `query` covers every model
 * operation AND the raw-query methods, inside interactive transactions
 * too — which is the point: drift can surface from any query on any page.
 */
function createClient(): PrismaClient {
  const extended = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  }).$extends({
    query: {
      $allOperations: async ({ args, query }) => {
        try {
          return await query(args);
        } catch (err) {
          throw markSchemaDrift(err);
        }
      },
    },
  });
  // TYPED AS THE PLAIN CLIENT ON PURPOSE. `$extends` returns a Proxy over
  // the same client with the same models, the same `$transaction` and the
  // same raw methods — but Prisma types it as `DynamicClientExtensionThis`,
  // and the callback of ITS `$transaction` is not assignable to
  // `Prisma.TransactionClient`, which twenty call sites across both lanes
  // declare (`tx: Prisma.TransactionClient`). Measured: exporting the
  // extended type produced 20 TS2345 errors in files this change has no
  // business touching. The only members an extended client drops are
  // `$on` and `$use`; nothing in this repo calls either, and
  // apps/web/lib/errorBoundaryCoverage.test.ts fails the build if
  // something starts to. The runtime proof that the hook fires on a real
  // P2022 is apps/web/lib/schema-drift.dbtest.ts.
  return extended as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  provaDbHostLogged: boolean | undefined;
};

/**
 * Says which database this process is actually connected to, once per cold
 * start.
 *
 * Host and database name only — the connection string carries a password
 * and these lines go to runtime logs. Deliberately not an env-var dump.
 *
 * This exists because the schema and the code drifted apart for a day and
 * nobody could tell: the Vercel build's `prisma migrate deploy` reported
 * success against one Neon endpoint while the app read another, and no log
 * either developer routinely looked at named either one. The build-time
 * check in packages/db/scripts/check-schema.mjs catches the misconfigured
 * pair; this catches the case that check can't see — a deployment that was
 * PROMOTED rather than built, where no build command ran at all.
 *
 * Never throws. A logging line that can break a cold start would be a worse
 * bug than the one it reports.
 *
 * Server only. This module reaches the browser bundle transitively, and
 * there `process.env.DATABASE_URL` is naturally undefined — so it printed
 * "[db] DATABASE_URL is not set" into the console of anyone who opened dev
 * tools, which is both meaningless and alarming, and was noticed during a
 * pre-demo walkthrough. The log is about the server's own connection; it
 * has no business running anywhere else.
 */
function logConnectionTarget() {
  // Deliberately not `typeof window`: this package is server-only and its
  // tsconfig has no DOM lib, so naming `window` does not typecheck — and
  // adding the DOM lib to claim a global it must never use would be the
  // wrong fix. packages/ui gets DOM types because it renders in a browser;
  // this one does not.
  if ("window" in globalThis) return;
  if (globalForPrisma.provaDbHostLogged) return;
  globalForPrisma.provaDbHostLogged = true;
  try {
    const raw = process.env.DATABASE_URL;
    if (!raw) {
      console.warn("[db] DATABASE_URL is not set");
      return;
    }
    const url = new URL(raw);
    const database = url.pathname.replace(/^\//, "") || "(no database named)";
    console.log(`[db] connected to ${url.hostname}/${database}`);
  } catch {
    console.warn("[db] DATABASE_URL is set but could not be parsed");
  }
}

logConnectionTarget();

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
