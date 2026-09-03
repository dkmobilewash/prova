import { PrismaClient } from "@prisma/client";

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

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
