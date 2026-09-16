### RFIs, submittals and drawings stopped calling things late a day early (Cyrus)
`cyrus/viewer-dates-correspondence`

From 5pm Pacific until midnight, `/rfis`, `/submittals` and `/drawings`
were a day into the future. All three worked out what day it was with
`new Date().toISOString().slice(0, 10)` — the SERVER's UTC day — and then
compared plain calendar dates against it. So every afternoon, an RFI due
today wore an **Overdue** badge and the status line said "1 RFI past the
date we asked for — #4 Tower B (1 day)"; a submittal the GC still had
until today read "with the GC past the due-back date"; and a drawing
revision missing two days read "waiting 3 days". These are the three
screens a sub takes into an argument about who sat on what, so a day out
is not cosmetic — it is being wrong in writing, at the GC, first.

This is issue #111 item 1 again, on the pages that fix did not reach. The
machinery was already here and already right: `components/TimeZoneCookie.tsx`
parks the browser's IANA zone in `prova_tz`, and `lib/viewerToday.ts` reads
it back on the server (cookie, then Vercel's geo-IP header, then UTC).
Nothing new was built — the three pages now call `await viewerToday()`
instead of the server clock. Deliberately NOT `components/localToday.ts`:
that one asks the browser during render, which is the hydration trap its
own comment warns about. The zone arrives as request data; the day is still
worked out on the server; storage and rendering are still UTC.

**Why nothing caught it.** `isOverdue` in `components/rfiLabels.ts` and
`components/submittalLabels.ts` is pure, correct and well tested — and its
tests hand it a `today` of their own choosing, so they cannot see which
clock the PAGE reads and would stay green on the UTC day forever. A test
that read the real clock would not have seen it either: it agrees with the
bug all morning and only disagrees after 5pm Pacific, which is the bug
wearing a disguise. So `app/(app)/correspondence-dates.test.ts` fixes both
ends — the instant (2026-09-16T02:00Z, 7pm on the 15th in Los Angeles) and
the zone (a `prova_tz` cookie) — and RENDERS each page with rows in it
rather than reading its source. It mocks the request, not `viewerToday`:
mocking the helper would only prove the page calls something with that
name. Every case carries a row that IS genuinely late, so "nothing says
overdue" can never pass on a page that failed to render.

**Mutations, all run, all red:**

| broken on purpose | result |
| --- | --- |
| `/rfis` back to `new Date().toISOString()` | RED — 2 RFI assertions + that page's guard (both RFIs overdue, "2 RFIs past the date") |
| `/submittals` back to it | RED — the due-back assertion + that page's guard |
| `/drawings` back to it | RED — "waiting 3 days" instead of 2, + that page's guard |
| the test's cookie renamed so no zone resolves | RED — all four behavioural assertions at once, proving they ride the real cookie chain and not the fixture dates |

**Not fixed here, and worth saying out loud: thirteen other pages have the
same line.** `/pipeline`, `/vendors/pricing`, `/material-orders`,
`/messages`, `/field-reports`, `/closeout`, `/prevailing-wage`,
`/deployment`, `/certifications`, `/equipment`, `/union-compliance`,
`/backcharges` and `components/ChangeOrders.tsx` all still date themselves
from the server's UTC clock. Several are in the other lane. This branch
fixed the three it was asked to fix rather than sweeping — `lib/serverToday.ts`'s
own comment says moving a caller is a change worth making deliberately.

One small thing removed on the way past: `/rfis` passed a `today` prop to
`RfiForm` that the component destructured and never read — its sent-date
default has always come from `localToday()`, correctly, since the form only
renders after a click. A dead prop named `today` in a file about dates is a
sentence that reads as a fact, so it is gone.
