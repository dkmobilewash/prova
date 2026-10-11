import crypto from "node:crypto";
import { prisma } from "@prova/db";
import { outboundConfig, runOutboundPush } from "@/lib/smartlead/run";

/**
 * THE NIGHTLY PUSH: the operator company's NEW, emailable, unsuppressed leads
 * go to the Smartlead campaign, at most `OUTBOUND_DAILY_CAP` a day.
 *
 * Scheduled at 14:00 UTC (vercel.json) — 7am Pacific in summer, 6am in winter
 * — so the sequencer's first sends of the day land in business hours.
 *
 * NOT protected by Clerk — see the note in middleware.ts. Authenticates the
 * scheduler itself with the same timing-safe `Authorization: Bearer
 * $CRON_SECRET` check as /api/notifications/digest.
 *
 * FAILS CLOSED: no `CRON_SECRET` → 503; any of the four outbound settings
 * unset → 503 naming which (`lib/smartlead/run.ts` says why the unsubscribe
 * link's two are on that list). A GET with side effects for the same reason
 * as the digest — Vercel Cron issues GET only — and safe to retry for the
 * same reason: only NEW leads are selected, and a pushed lead stops being NEW
 * in the transaction that records it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request, secret: string): boolean {
  const offered = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return offered.length === expected.length && crypto.timingSafeEqual(offered, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return json({ ok: false, error: "CRON_SECRET is not configured" }, 503);
  if (!authorized(request, secret)) return new Response("Unauthorized", { status: 401 });

  const config = outboundConfig(process.env);
  if (!config.ok) {
    return json({ ok: false, error: `Not configured: ${config.missing.join(", ")}. Nothing was sent.` }, 503);
  }

  const operator = await prisma.company.findFirst({ where: { isProvaOperator: true }, select: { id: true } });
  if (!operator) return json({ ok: false, error: "No operator company. Nothing was sent." }, 503);

  const report = await runOutboundPush({ companyId: operator.id, config });

  // One line per run, no addresses.
  console.log(
    `[outbound-push] sent=${report.sent} added=${report.added ?? "?"} skipped=${report.skipped ?? "?"} room=${report.room}/${report.dailyCap} dnc=${report.excluded.doNotContact} no-email=${report.excluded.noEmail} not-new=${report.excluded.notNew} over-cap=${report.excluded.overCap} error=${report.error ? "yes" : "no"}`,
  );

  // Non-2xx when the run did not do its whole job, like the digest: a red
  // invocation is one somebody looks at.
  return json({ ok: report.error === null, ...report }, report.error === null ? 200 : 502);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
