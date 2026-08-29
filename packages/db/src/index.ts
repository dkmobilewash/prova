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
 */
function logConnectionTarget() {
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
