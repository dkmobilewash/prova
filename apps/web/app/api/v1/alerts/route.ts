import { NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { loadAlerts } from "@/lib/alerts-query";
import { serverToday } from "@/lib/serverToday";

export const dynamic = "force-dynamic";

/**
 * The phone's alert list.
 *
 * DELIBERATELY UNGUARDED beyond the session, and pinned OPEN in
 * lib/mobile-api-guards.test.ts for the same reason as the job list:
 * there is no single capability that covers it — fourteen kinds sit
 * behind eight different capabilities — and `loadAlerts` already applies
 * the per-kind capability filter AND the money strip server-side against
 * the session's own principal. Guarding here with any one capability
 * would be a weaker, arbitrary second opinion over an already-correct
 * filter.
 *
 * The principal is passed EXPLICITLY — `loadAlerts` defaults to an
 * unrestricted owner, and letting that default through would hand a
 * field user an owner's list.
 *
 * `?today=` is the phone's own calendar day (the same convention as the
 * schedule route); absent, the server's day — the cron and the phone
 * disagreeing about "today" is exactly the class of bug the digest
 * takes a date for.
 */
export async function GET(request: Request) {
  const context = await requireApiContext();
  if (!context) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const todayParam = url.searchParams.get("today");
  let todayIso: string;
  if (todayParam !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(todayParam)) {
      return NextResponse.json(
        { error: "today must be a yyyy-mm-dd date" },
        { status: 400 },
      );
    }
    todayIso = todayParam;
  } else {
    todayIso = serverToday();
  }

  const { visible } = await loadAlerts(
    context.company.id,
    context.id,
    todayIso,
    { role: context.role, jobFunction: context.jobFunction },
  );

  return NextResponse.json(
    visible.map((alert) => ({
      key: alert.key,
      kind: alert.kind,
      severity: alert.severity,
      title: alert.title,
      detail: alert.detail,
      href: alert.href,
      dueOn: alert.dueOn,
      daysUntil: alert.daysUntil,
      // `amount` rides along null for anyone whose principal strips it —
      // the phone renders no money in v1, and the field must never be a
      // second place deciding the rule.
      amount: alert.amount,
    })),
  );
}
