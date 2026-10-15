import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@prova/db";
import { runPublicWorksSync } from "@/lib/public-works/sync";

/**
 * The public-works sync, for a scheduler: one slice of the state's record
 * per call, stalest first — see lib/public-works/sync.ts.
 *
 * NOT protected by Clerk — see the note in middleware.ts. A scheduler has no
 * session; this authenticates the request itself the way
 * /api/notifications/digest does, and FAILS CLOSED on a missing
 * `CRON_SECRET`. A GET with side effects, because Vercel Cron issues GET and
 * nothing else, and defensible because every write is idempotent: firms
 * upsert on licence, signals insert on DIR's own key.
 *
 * THIS IS NOT THE SCHEDULER, and measured timings are why. One slice runs
 * 95–290 seconds against the live portals (CSLB's 78 MB file; DIR's
 * link table at 44 pages; a big county's eCPR search in halved windows),
 * and this function dies at 60. So the daily pull is a GitHub Actions
 * workflow (`.github/workflows/public-works-sync.yml`) running
 * `scripts/public-works-sync.ts` with a 50-minute budget — the same place
 * and secrets `migrate.yml` already uses. This route and the page's button
 * remain for a one-off nudge, and a slice they cannot finish is harmless:
 * every write is idempotent and the bookmark is only written on completion,
 * so the next scheduled run simply does that slice again.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const report = await runPublicWorksSync({ prisma, budgetMs: 45_000 });
  return NextResponse.json(report);
}
