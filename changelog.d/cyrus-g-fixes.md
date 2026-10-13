### Six things the owner found clicking Concept G, fixed (Cyrus)
`cyrus/g-fixes`

**The bottom figures strip is gone.** The old metric bar (estimated revenue,
gross margin, cash collected, retainage held) sat at the foot of every page
and covered things — "Review & send" on a job's Billing stage. Concept G has
no bottom chrome, so the four figures now head the Money area
(`/areas/money`), behind the same VIEW_COMPANY_FINANCIALS gate, and the
layout no longer runs that query on every page. While measuring it, the
phone's bottom tabs turned out to be 64.5px tall against the 56px the page
padded by, so 8.5px of every phone page sat under them; the tabs are a fixed
65px now, and the scroll port is scroll-padded by the same amount so a
focused control stops above them too. Check: `shellRegion.test.ts` holds the
bar out of the layout and the two paddings on `<main>`;
`page-money-guards.test.ts` holds the gate on the area page.

**A job stage no longer ticks itself while saying something is missing.** An
IN_PROGRESS job with no signed contract showed a green tick beside "Not
signed · 1 CO". A stage the job has passed without its own fact (contract
unsigned, nobody on the crew, nothing billed) is now an amber "!" with the
status in amber. Check: `jobStages.test.ts` sweeps every combination and
fails if any "done" stage carries a missing-fact status.

**A past due date says so.** "Pay app #2 due Oct 2" read neutral on Oct 10.
Every due date in Concept G (Billing step, pay-app pill, home Needs-you and
job card, area lists) now reads "overdue N days" in the danger tone, through
one helper (`lib/due-date.ts`) counted on the viewer's calendar
(`viewerAsOf()`), never the server's UTC day. Check: the Los Angeles evening
case in `jobStages.test.ts`, with the server-day answer as its control.

**The search box no longer flashes "Ctrl K" on a Mac.** The server renders no
key hint; the right one appears after hydration, so nothing swaps.

**Area dropdowns open under their own box.** Paperwork's panel opened 450px
to its left because alignment was by column index. It is measured now:
left-aligned with its box, flipped to right-aligned only when it would run
off the right edge, never off-screen, and as tall as the space below the box
with its own scroll beyond that. Check: `placePanel` tests; measured in
Chromium at 1440x900 (panel 728–1368 under a box at 728–920, bottom 883).

**Area tool cards say each thing once.** No big number repeating the status
line; every button reads "Open <tool>" (truncating rather than falling back
to a bare "Open"); brand yellow only on a genuine create ("+ New job").
