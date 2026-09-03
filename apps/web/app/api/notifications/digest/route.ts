import crypto from "node:crypto";
import { dispatchAlertDigest } from "@/lib/notification-dispatch";
import {
  DEFAULT_RUN_BUDGET_MS,
  configuredBaseUrl,
  runDigests,
} from "@/lib/notification-run";
import { loadDigestRecipients } from "@/lib/notification-run-query";
import { serverToday } from "@/lib/serverToday";

/**
 * The thing that runs when nobody is looking.
 *
 * Sheet 26 of FEATURE-AUDIT.md held five rows at Partial for exactly one
 * reason — "nothing runs unattended" — and this is that. Everything under
 * it already existed: the alert engine decides what is true, the milestone
 * ledger decides what has already been said, and `dispatchAlertDigest`
 * sends and records. This adds a caller with no person behind it.
 *
 * NOT protected by Clerk — see the note in middleware.ts. A scheduler has
 * no session and never will. It authenticates the request itself, below.
 *
 * FAILS CLOSED, TWICE, and neither is a formality:
 *
 *   - No `CRON_SECRET` → 503, nothing read, nothing sent. The URL is
 *     otherwise the only thing standing between anyone on the internet and
 *     a button that mails every user of every company.
 *   - No `NOTIFY_BASE_URL` → 503, nothing sent. Every link in the email
 *     body is built from that origin, and there is no safe guess: an email
 *     that looks right and whose links go somewhere else is worse than no
 *     email. See `configuredBaseUrl`, and the docstring on
 *     `originFromRequest` in lib/actions/notifications.ts explaining why
 *     the button's request-derived host must NOT be reused here.
 *
 * **A GET WITH SIDE EFFECTS, deliberately.** Vercel Cron issues GET and
 * nothing else, so the alternative is no schedule. What makes it
 * defensible is the property this whole feature is built on: the run is
 * idempotent by construction. A notice is claimed by its milestone key
 * before the provider is called, so a second GET a second later sends
 * nothing. That is also why a retry after a failed invocation is safe.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sixty seconds is the platform floor across plans, so this value is
 * valid everywhere. The run's own budget sits below it — see
 * DEFAULT_RUN_BUDGET_MS for why stopping ourselves beats being stopped. */
export const maxDuration = 60;

/**
 * The scheduler proving it is the scheduler.
 *
 * Vercel attaches `Authorization: Bearer $CRON_SECRET` to a cron request
 * when that variable is set on the project — and attaches NOTHING when it
 * is not, which is precisely why the missing-secret case must reject
 * rather than wave the request through. Unset means the schedule does not
 * work; it must never mean the schedule works for everybody.
 *
 * Timing-safe, the same as the Resend webhook: a plain `===` on a secret
 * leaks how much of it was right, one byte at a time, and this endpoint
 * can be hit as often as anyone likes.
 */
function authorized(request: Request, secret: string): boolean {
  const offered = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return (
    offered.length === expected.length &&
    crypto.timingSafeEqual(offered, expected)
  );
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // 503 rather than 500, matching the webhook: a configuration state is
    // not a fault, and the scheduler should keep trying once it is set.
    return json({ ok: false, error: "CRON_SECRET is not configured" }, 503);
  }
  if (!authorized(request, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const baseUrl = configuredBaseUrl(process.env.NOTIFY_BASE_URL);
  if (!baseUrl) {
    return json(
      {
        ok: false,
        error:
          "NOTIFY_BASE_URL is not set to a valid origin, so email links would point nowhere. Nothing was sent.",
      },
      503,
    );
  }

  // ONE date for the whole run, computed once. Two people mailed either
  // side of midnight UTC must not disagree about what day it is — the same
  // reason `dispatchAlertDigest` takes the date instead of reading a clock.
  const today = serverToday();

  const budgetMs = Number(process.env.NOTIFY_RUN_BUDGET_MS) || DEFAULT_RUN_BUDGET_MS;

  const recipients = await loadDigestRecipients();
  const report = await runDigests({
    recipients,
    budgetMs,
    dispatch: (recipient) => dispatchAlertDigest(recipient, today, baseUrl),
  });

  // One line per run, in the deployment log, with no addresses in it.
  console.log(
    `[alert-digest] ${today} considered=${report.considered} sent=${report.sent} nothing-due=${report.nothingDue} already-claimed=${report.alreadyClaimed} failed=${report.failed} not-attempted=${report.notAttempted} stopped=${report.stopped ?? "no"}`,
  );

  // **THE STATUS CODE ANSWERS "DID THIS RUN DO ITS WHOLE JOB", NOT "DID IT
  // RESPOND".** A run that mailed forty people and threw on the
  // forty-first must not look identical to a clean one — a green
  // invocation nobody reads the body of is exactly how this repo has been
  // fooled before. Anything short of every person attempted and nobody
  // failed is a non-2xx, and the body carries the detail either way.
  // Re-running is safe, so a red invocation is a thing that can simply be
  // retried.
  const clean = report.failed === 0 && report.stopped === null;
  const status = clean ? 200 : report.stopped === "email-not-configured" ? 503 : 500;

  return json({ ok: clean, today, baseUrl, ...report }, status);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
