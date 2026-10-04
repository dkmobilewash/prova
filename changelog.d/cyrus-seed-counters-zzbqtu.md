### What actually changed, in plain English (Cyrus)
`cyrus/seed-counters-zzbqtu`

**Four alert kinds were being built and thrown away, and had been since they
shipped.** `loadAlerts` computed `permitted = visibleToPrincipal(alerts, …)`
partway down the function and then pushed four more kinds onto `alerts`
afterwards. `visibleToPrincipal` returns a NEW array, so that assignment was a
snapshot — the late delivery, the aging punch item, the equipment still out on
a finished job and the delay the GC was never told about were assembled,
capability-checked, and never returned. The bell and `/alerts` had never shown
one of them.

Nothing failed and nothing could. The builders were called. Their unit tests
passed, because they are pure functions given inputs directly. The capability
map was exhaustive over every kind. `itemLinksCensus.test.ts` found all four
hrefs and proved each was reachable by the person who receives it. Every
instrument was pointed at whether the alerts were CORRECT; the defect was
whether they were RETURNED — the shape CLAUDE.md's newest trap entry names,
arriving in the alert engine rather than on the phone: nothing is ever missing
from a question nobody is asking.

The fix is moving one statement below the last push. `alertAssemblyOrder.test.ts`
is the part worth keeping: it asserts every builder `alerts-query.ts` imports is
actually called, that no push lands after the snapshot, and that nothing sits
between the snapshot and the return where a future push could land. Three
mutations, each red and each naming the offender — the snapshot restored to its
old position (names all six stranded line numbers), a builder imported and never
called, and the anchor present only inside a comment, which a raw-text census
would have read as code and passed.

**The two apprenticeship deadlines now reach the bell.** `das140Standing` and
`das142Standing` have been right since they were written, and were rendered in
exactly one place each — the job's compliance tab and the two detail pages — so
the only way to learn a DAS 140 was overdue was to open the job it was overdue
on and look. Same invisibility as the field four above, on the one deadline in
the app carrying a statutory penalty.

`DAS140_NOTICE` fires on an unsent notice that is late or within ten days of
due. Ten is the whole statutory window rather than a runway in front of it,
because the other bound — the first day a worker logs hours — can close the
window on day one. `DAS142_DISPATCH` fires three ways: a request unsent past
its latest send day ("already short notice"), one whose needed day has gone
entirely, and one that went out with no committee answer recorded at all. The
last is STANDING, not overdue: the committee's answer has no date this app was
ever told.

Neither builder re-derives a date. Both call the module written to be the only
place that decides them, for the reason `lienDeadlineAlerts` calls
`lienDeadlineState` — a second opinion about a statutory deadline, in a red
badge, is the one place a wrong one gets acted on. Severity is read off the
standing rather than recomputed from the date; the horizon decides only whether
a deadline still ahead is close enough to mention. Neither asserts a
consequence: every citation in `das-forms.ts` is `verified: false`, located by
search and never read off a primary DIR page, so an alert claiming "this is
your defence at a hearing" would invent the one thing that file refuses to
claim. `dasAlerts.test.ts` pins the holiday caveat's DIRECTION, because the
alert tells people a holiday makes the real cut-off earlier — which is only
safe advice while the caveat still runs that way.

**Two existing censuses were quietly unable to see what they were checking, and
both said so when asked.** `itemLinksCensus.test.ts` matched a kind name as
`[A-Z_]+`; `DAS140_NOTICE` was the first kind with a digit in it (the form
number is the name), so the census reported both new kinds as building no href
at all. It failed by NAME rather than shrinking to an empty set, which is what
its size assertion is for. And `appHelpRouteCensus.test.ts` normalised every
`${…}` in an href to `[id]` but compared against page paths named whatever the
page called them — so `/jobs/[id]/das-140/[id]` could never match
`/jobs/[id]/das-140/[noticeId]`, and the census had been structurally unable to
resolve ANY nested dynamic route. Both sides are normalised now; segment count,
order and every literal segment are still compared, and only the parameter
name, which an href cannot get wrong, stops mattering. Mutation-tested by
pointing a DAS href at `/das-999/` and watching it go red.

One small thing that is a finding rather than a fix: `das142Alerts` writes its
href out in full at each of three push sites instead of hoisting it into a
`const`. A shorthand `href,` is invisible to the census that checks the person
receiving an alert can open the page it points at, and a census that cannot see
the destination cannot check anything about it.
