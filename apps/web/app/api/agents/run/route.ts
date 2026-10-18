import crypto from "node:crypto";
import { isCronAgent, runScheduledAgent, scheduledRunClean } from "@/lib/agents/cron";

/**
 * The agent run a person (or a one-off `curl`) can start with the
 * CRON_SECRET: the bid watcher by default, `?agent=RECOMMENDATIONS` the
 * other one. Nothing else: BID_RESEARCH and ESTIMATE_CHECK run on an event
 * or a person's press, and a URL must not be able to start model runs
 * across every company.
 *
 * NOT SCHEDULED ITSELF any more — see lib/agents/cron.ts: Vercel's Hobby
 * plan allows two cron jobs on `prova-web` and both were taken, so the daily
 * digest (`/api/notifications/digest`) runs the watcher after its own work.
 * This route stays for a manual run and as the thing a schedule could point
 * at again on a plan with room.
 *
 * NOT protected by Clerk — see the note in middleware.ts. A scheduler has no
 * session. It authenticates the request itself with a timing-safe check of
 * `Authorization: Bearer $CRON_SECRET`, copied from
 * /api/notifications/digest, and FAILS CLOSED with 503 when the secret is
 * unset: unset must mean the schedule does not work, never that it works
 * for anyone who knows the URL.
 *
 * A GET with side effects because Vercel Cron issues GET only. It is safe
 * to repeat: every watcher finding carries a dedupeKey.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request, secret: string): boolean {
  const offered = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return offered.length === expected.length && crypto.timingSafeEqual(offered, expected);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return json({ ok: false, error: "CRON_SECRET is not configured" }, 503);
  if (!authorized(request, secret)) return new Response("Unauthorized", { status: 401 });

  const asked = new URL(request.url).searchParams.get("agent") ?? "BID_WATCHER";
  if (!isCronAgent(asked)) {
    return json({ ok: false, error: `${asked} does not run on a schedule` }, 400);
  }

  const counts = await runScheduledAgent({ agent: asked });
  // Same rule as the digest: the status answers "did this run do its whole
  // job". A run that failed a company or ran out of time is not a 200.
  const clean = scheduledRunClean(counts);
  return json({ ok: clean, agent: asked, ...counts }, clean ? 200 : 500);
}
