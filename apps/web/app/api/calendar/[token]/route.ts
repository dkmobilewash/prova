import { NextRequest } from "next/server";
import { prisma } from "@prova/db";
import { buildCrewScheduleCalendar } from "@/lib/ics";
import { crewScheduleEvents, loadCalendarSchedule } from "@/lib/calendar-feed";

/**
 * The subscribable crew-schedule calendar: GET /api/calendar/<token>
 * answers ICS, and the token in the path is the WHOLE of the
 * authentication — Apple/Google/Outlook poll this URL with no cookies and
 * no login, exactly the position the portal and e-sign links are in. The
 * token comes from `linkToken()` (192 bits) and maps to one user in one
 * company; what it serves is what that person sees on /schedule (see
 * lib/calendar-feed.ts for the scope argument).
 *
 * EVERY DEAD TOKEN IS THE SAME 404. Never existed, regenerated away, or
 * the person left the company — one status, one body, no
 * `Cache-Control` difference. lib/access-tokens.ts states the rule this
 * follows: a dead link must not teach whoever holds it anything about its
 * history. (A regenerated token isn't marked dead anywhere — the value is
 * REPLACED on the row, so the old string simply matches nothing, which is
 * indistinguishable from never having existed even to the database.)
 *
 * `serverToday()` (the UTC calendar day) anchors the window rather than
 * any per-user zone: the feed has no signed-in user to read a timezone
 * cookie from, the events are all-day DATE values that no client shifts,
 * and a ±14-day window makes an off-by-one at the edges invisible.
 */

export const dynamic = "force-dynamic";

const NOT_FOUND = () =>
  new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // linkToken() is 48 hex chars; anything else cannot be a live token, so
  // it 404s without a query — same response, cheaper.
  if (!/^[0-9a-f]{48}$/.test(token)) return NOT_FOUND();

  const row = await prisma.calendarFeedToken.findUnique({
    where: { token },
    select: {
      companyId: true,
      user: { select: { companyId: true } },
      company: { select: { name: true } },
    },
  });
  // The second check is the person LEAVING: requireCompanyContext moves a
  // user between companies by rewriting user.companyId, and a token minted
  // under the old company must die with the move, not keep serving the old
  // company's schedule to someone no longer in it.
  if (!row || row.user.companyId !== row.companyId) return NOT_FOUND();

  const today = new Date().toISOString().slice(0, 10);
  const rows = await loadCalendarSchedule(row.companyId, today);
  const body = buildCrewScheduleCalendar(crewScheduleEvents(rows), {
    calendarName: `${row.company.name} crew schedule`,
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // Modest: calendar apps poll on their own schedule anyway; five
      // minutes keeps a double-poll from re-running the query without
      // letting a revoked token's LAST body linger anywhere long.
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": 'inline; filename="crew-schedule.ics"',
    },
  });
}
