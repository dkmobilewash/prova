### A new RFI is a draft until somebody says it was sent (Cyrus)
`cyrus/sent-date-default`

Open **Raise an RFI**, type a question, save. That RFI was SENT — the
"Date sent" box arrived pre-filled with today, and nothing on the form
said so. The row that comes back offers *Record answer* and *Edit* and
nothing else: `deleteRfi` takes drafts only, and `updateRfi` refuses
SENT → draft, so clearing the date afterwards is refused too. Both
guards are correct and neither has changed. The default was landing
people on the wrong side of them, permanently, on their first use of the
page.

Under that field, the whole time: *"Blank keeps it a draft. Backdate it
when you're entering an RFI you already sent."* Blank was never the
state the form started in. The submittal form said the same thing —
*"Blank means it hasn't gone out yet"* — and `createSubmittal`'s own
comment says it a third time, *"registered but not submitted, and
deletable"*. Three sentences describing a path the form made
unreachable.

**And the date is the evidence, not metadata.** The page's own header
calls an RFI sent on a date and answered three weeks later "the
documentation behind a delay claim", and days-outstanding is computed
from `sentOn`. An office writing up Monday's question before it has
actually gone out recorded "sent Sep 21" and started a delay clock on a
day nothing left the building — a number that may end up in front of a
GC.

So both create forms open with Date sent **blank**, which is the
recoverable state: a draft can be edited, deleted, and then marked sent
on the real day with the **Mark sent** button that was already there. In
`SubmittalForm` the next input in the same grid was already
`defaultValue=""`; the blank form was one character away in the same four
lines.

**What deliberately did NOT change, because "no `localToday()` on a sent
date" is the wrong rule.** `SubmittalRow`'s send form — reached by
clicking *Record as sent* or *Send revision N* — keeps today. Sending is
the action the user has just chosen there, the field is `required`, and
a blanket sweep would have broken it. `BackchargeForm`'s `issuedOn` keeps
today too, and that was checked rather than assumed: a new backcharge is
`RECEIVED`, and in that status `updateBackcharge` leaves `issuedOn`
editable and `deleteBackcharge` allows the row to be removed. Nothing
about it is one-way, so it is not this bug.

**Second thing, same pages.** The RFI row rendered `sent 2026-09-21` —
a raw ISO string on a page whose own example rows read "asked Sep 4".
Submittal revisions did it too. Both now go through
`formatCalendarDay` in `lib/render-date.ts`, a `YYYY-MM-DD` wrapper over
the existing `formatCalendarDate`, so the UTC-midnight rule #101 already
enforces holds here as well instead of being re-derived. (`new
Date("2026-09-21")` is UTC midnight; `new Date("2026-09-21T00:00:00")`
is LOCAL midnight. One character, one day, west of UTC — pinned in the
helper rather than at each call site.)

**The check:** `components/sentDateDefault.test.ts` renders all three
forms for real in happy-dom, clicks them open, and reads the value off
the DOM — every query throws rather than returning null, so a form that
stopped rendering the field cannot pass. Two blanks and one today in the
same file, because the third case is what stops this being "fixed" in
both directions later. Mutation-tested five ways: restoring
`localToday()` in `RfiForm`, restoring it in `SubmittalForm`, restoring
the raw ISO in either row, and sweeping `localToday()` out of the send
form as well — each turns exactly one test red and leaves the other four
green.

**Not swept, and found by the same grep:** `DrawingSetRow.tsx` (127,
332, 333), `WorkerCertificationRow.tsx` (146, 148) and
`BackchargeRow.tsx` (327, 328, 329) print raw ISO days the same way.
Backcharges are Diego's lane; the other two are separate pages that need
their own click-through.
