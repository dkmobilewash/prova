### Fifteen more things the assistant can look up

`open_submittals`, `certification_expiry`, `apprentice_ratio`,
`closeout_status`, `fringe_remittance`, `backcharge_exposure`, `apprenticeship_standing`,
`daily_field_reports`, `wage_determinations`, `job_photos`, `vendor_pricing`
`gc_relationship`, `pay_application_status`, `warranty_obligations` and
`outbound_messages`, taking the read surface from fifteen tools to thirty.
All fifteen are reads — nothing new can be written, and no command was
added.

**`open_submittals` — "what is the GC still sitting on?"** Submittals sent
and not returned, with days outstanding, the date back, and whether it has
passed. The mirror of `open_rfis`, which answers the same question about the
other direction of correspondence.

Its one subtle rule, and the reason it has its own test file: **open is
derived from the LATEST revision, never stored.** A submittal rejected at
revision 1 and re-sent as revision 2 is open again on the new revision, and
the two natural implementations are wrong in opposite directions on that one
row — reading the oldest revision calls it closed on the day it most needs
chasing, and asking "does it have any unreturned revision" calls it open
forever once a revision was superseded without a response date. A submittal
with NO revisions has never been sent; it is a draft, and counting it would
put the sub's own unfinished paperwork on a list titled "what the GC owes
us".

`pastDue` is stated rather than left as two dates for the model to subtract,
because the prompt forbids it to do arithmetic. It is **null, not false**,
when no date back was ever agreed — false would be a claim that it is on
time, which nobody knows.

**`certification_expiry` — "who is going to be turned away at the gate?"**
Cards expired or expiring, worst first, with whose they are.

**A certification with no expiry date is carried, marked undated, and sorted
last.** That is the whole reason this one is not four lines: null is not less
than anything, so any naive `expiresOn <= window` filter drops it, and the
tool then answers "nobody is expiring" while somebody walks onto a site with
an undated card. Undated is a gap in the records, not an emergency — present
enough to chase, never ranked above a card that lapsed yesterday.

The window is the other half. The model sends a string, and an unreadable one
falls back to sixty days rather than returning an empty list, because "no
certification is expiring" is the one wrong answer this tool must never give.
Sixty is the window `/compliance` already uses, so the assistant and the
screen cannot disagree about what "soon" means.

An `OTHER` card is named by whatever was typed into `otherLabel`, and says
"Unnamed certification" when nothing was — never the literal word "Other" as
if that were the name of a card.

**`apprentice_ratio` — "are we in ratio?"** Per job, per union local, for a
month, from `loadRatioReviews` — the same function /union-compliance
renders, so the page and the assistant cannot report a different number of
days over.

This is the only tool in the registry whose answer could be quoted into a
certified-payroll conversation, so the interesting question about it is what
it says when it does not know. **A month containing days nobody could
classify is not a compliant month; it is a month nobody can certify.**
`daysOver === 0` is true of such a month and means nothing, so the verdict
is false when any day is incomplete — and null, not true, where no ratio
rule is on file for that local at all. A verdict from a rule that does not
exist is worse than no verdict.

The rule is rendered as the page's own phrase, "1 apprentice per 3
journeymen", so the model cannot print the ratio upside down. An unreadable
month falls back to the current one, because an empty review reads as "you
were in ratio" about a month nobody checked.

**`closeout_status` — "what is stopping us getting the last of it?"** Stage,
blockers, retainage at stake and how long the GC has had the package, from
`loadCloseoutJobs`.

Two things a reasonable implementation gets wrong here. **Blocker order is
data** — `closeoutReadiness` returns them most-binding-first so a caller
showing one shows the thing to do next, and sorting them replaces that
judgement with an arbitrary one. And **retainage is not a blocker**; it
rides alongside. Folding it in puts an item nobody can action on a list
titled "what is stopping us", and loses the sentence that makes the real
ones matter — this is what they are costing.

Stage and blocker text come from `closeoutPackageLabels`, which /closeout
renders. "No closeout checklist yet, so nothing has been asserted" is worth
preserving exactly: it is not the same claim as "nothing is wrong".

**`fringe_remittance` — "what do we owe the funds?"** Per local, per month,
priced from `loadRemittance` — the schedule in force on each DAY worked, not
the one in force today, which is why that module exists rather than a
multiplication here. Broken out by pension, vacation, health-and-welfare and
training, with whether the month has been filed.

**The hours nobody could price are lifted to the top of the result, with the
names behind them.** An unpriced hour is a hole in the remittance — no craft
tag, or no schedule effective on that date — and valuing it at zero produces
a total that looks like an answer and underpays a fund. That is the one
mistake in this registry that costs a member their benefits rather than
costing the company a correction. Buried in a per-local detail row, an answer
can be written that never mentions it.

**`backcharge_exposure` — "what is being charged back, and what have we not
answered?"** What the GC claims, on which job, its status, and **the date by
which we must object** — stated as past or not, never left as two dates to
subtract. A backcharge sits in an email thread until it is simply deducted,
and the window to dispute it is contractual. `claimedAmount` is what the GC
ASSERTS and is never an agreed figure; `pastRespondBy` is null, not false,
where no date was recorded.

**`apprenticeship_standing` — "is anybody behind on their hours?"** From
`loadApprenticeships`, which /union-compliance renders.

**Its value is entirely in what it refuses to flatten.** Three states a
summary collapses into "not met" send three different people to do three
different things: SHORT means hours are recorded and under, so chase the
hours; NOT_RECORDED means there is a requirement and nobody logged anything,
so chase the paperwork and not the apprentice; NO_REQUIREMENT_RECORDED means
the programme has no figure on file, and calling that "short" invents a
standard nobody set. They are counted separately. An enrollment carrying
both a completion AND a cancellation date is reported as contradictory
rather than resolved by precedence — picking one hides a data-entry error on
a compliance record.

**`daily_field_reports` — "what did we write up?"** Most recent first, with
the work, the crew, the weather and any delay. **Reports carrying a delay
are flagged**, because a delay noted on the day is the contemporaneous
record a claim gets built on months later. A whitespace-only delay field —
what a form submits when somebody tabbed past it — does not count as one.

The empty-state sentence is the careful part: *"nobody wrote one up, not
that nothing happened."* A job with no reports is a fact about the
paperwork, and an answer implying it is a fact about the site is worse than
no answer.

**`wage_determinations` — "have we got it on file?"** Per job, with the
jurisdiction and **whether the document is actually attached or linked**. A
row with NEITHER is flagged: it is a determination in name only, it cannot
be produced in an audit, and it is the shape most likely to be mistaken for
coverage — because it exists, so a count says the job is covered.

**It deliberately never says a determination is MISSING.** Nothing in the
schema records whether a job is public works, so "this job has no
determination" is not evidence of a gap; it may simply be private work.

**`job_photos` — "do we have pictures of that?"** Per job: how many, when
the most recent was **taken**, how many carry a caption, how many are shared
with the GC by link. The date is `capturedAt`, never `createdAt` — a dispute
turns on when the photo was taken, and the two can be weeks apart when a
foreman clears his phone at the end of a month. A count is not proof of
coverage, and the description says so: nothing here can know whether the
thing you need a picture OF was photographed.

**`vendor_pricing` — "is that price still good?"** Quotes with the vendor,
the date and the validity window. **A quote past its validity date is
flagged expired rather than listed as a current price** — an expired quote
carried into a bid is how a job gets mis-priced. A quote with no validity
date is null, not false: "not expired" would claim the price still stands,
and nobody recorded anything that says so. Counted apart from expired ones,
because one is a stale price and the other is a vendor who never gave terms.

**`gc_relationship` — "can we still bid this GC?"** Three independent
things, none of which implies another: the MSA, the prequalification, and
**whether the portal link they hold still works**. A GC whose MSA lapsed in
March can still have a live link into your job. Every unrecorded date reads
as unrecorded, never as current — "the MSA is fine" is the sentence somebody
repeats to a GC before finding out.

**`pay_application_status` — "has the GC approved it yet?"** Where each
application sits in the GC's process, and how long it has sat there.
Deliberately not the same question as `receivables`, which answers who owes
what and how overdue: this is the question asked the week **before** the
money is late.

**A DISPUTED application is counted apart from a slow one**, because it
changes what somebody does. Everything else on the list gets chased; a
dispute is a conversation, and chasing it as though it were slow is how a
fortnight goes.

**`warranty_obligations` — "are we still on the hook?"** The end date is
derived from the start and the months, never stored. Callbacks are split
open from resolved, with the oldest open one dated.

**A job with no warranty period recorded reads as UNRECORDED, not as out of
warranty.** Nothing here knows what a subcontract obliges; it knows what
somebody typed. "You're clear" read off an empty field is the one answer
this tool must never give — and a job with nothing recorded at all is left
out of the list rather than reported as clear.

**`outbound_messages` — "did that actually reach them?"** The vocabulary is
already written down in `MessageEventType` and this tool carries it rather
than flattening it: SENT is handed to the provider and is **not** the same
as arrived; DELIVERED is the only status that means the receiving server
took it; BOUNCED carries the reason, which is what makes it fixable.

**The LATEST event is what counts** — a message that bounced after being
sent is bounced, and reading the first event calls it sent while somebody
waits for a reply to an email that never arrived. A message with nothing
back yet is null, not "sent". And opens are reported but **nothing is ever
concluded from their absence**, because image-blocking makes a missing open
meaningless — there is deliberately no "unopened" figure in the summary.

**Capabilities follow the page each cites**, which is the rule `tools.ts`
already states: `/submittals` is `MANAGE_JOBS`, `/certifications` is
`MANAGE_FIELD`, `/union-compliance` is `MANAGE_COMPLIANCE` (for both the ratio and the
remittance), `/closeout` is `MANAGE_JOBS`, `/backcharges` is
`MANAGE_BILLING` — a backcharge is money coming off the next cheque, so it
sits with whoever chases the cheque rather than with compliance —
`/field-reports` is `MANAGE_FIELD`, `/prevailing-wage` is
`MANAGE_COMPLIANCE`, `/photos` is `MANAGE_FIELD`, `/vendors/pricing` is
`MANAGE_ESTIMATING`, `/closeout` is `MANAGE_JOBS` for warranty, and
`pay_application_status` takes the `MANAGE_BILLING` literal that
`receivables` already uses — the pay applications section renders inside
the job page's money branch rather than on its own route.

**Two capabilities are worth a reviewer's eye rather than a nod**, and both
for the same reason. `outbound_messages` takes `null` because `/messages` is
on the open list — the delivery log is open to every signed-in person and
sending is the action's problem rather than the page's. And
`gc_relationship` takes `null`, because `/contacts` is on
`lib/permissions.test.ts`'s open list — *"the address book: names and phone
numbers are not a tier"*. That is the rule this file states, applied
straight. But an MSA expiry is a commercial term rather than a phone
number, and if a tighter gate is right here then **the page needs it
first**: a tool stricter than its own screen refuses what the person can
already read, which is worse than either answer. The second is worth naming — the question is "who can start
on Monday", which a foreman asks and a compliance manager does not.

**What adding a tool actually costs here, recorded because it is the good
news.** Four separate registries refused the change until each was updated:
the `ToolName` union, the `HANDLERS` map, `toolLabels`, and two test-side
censuses — one asserting every tool's capability matches its citation page,
one asserting every tool has at least one routing eval case. Nothing shipped
half-wired, and none of it needed remembering.

79 new tests. Twenty-two mutations watched RED and restored: counting never-sent
drafts as open, reporting `pastDue: false` where no date was agreed, dropping
undated certifications, returning nothing on an unreadable window, reading the
ratio verdict off `daysOver` alone, giving a verdict where no rule exists,
passing an unreadable month straight through, sorting the closeout blockers,
burying the unpriced remittance hours, counting settled backcharges as
exposure, reporting `pastRespondBy: false` where no date was recorded, folding
NOT_RECORDED hours into "short", counting a whitespace-only delay as a
delay, calling a determination with no file and no link producible,
reporting a photo's share date instead of its capture date, treating an
undated vendor quote as current, reading an unrecorded MSA date as current,
reporting a revoked portal link as live, folding DISPUTED in with awaiting
approval, reading an unrecorded warranty as expired, reading the FIRST
delivery event instead of the latest, and reporting a message with no event
as sent.

**Two things writing the tests found, rather than the tests confirming what
was already right.** The backcharge summary counted `pastRespondBy` across
every row including SETTLED ones — a closed backcharge whose window lapsed
months ago is not something anyone can act on, and counting it inflates the
one number meant to make somebody move today. It counts the open ones now.
And the first version of the remittance total test computed a figure and
asserted it differed from another, which was a tautology that passed on
nothing; it asserts the loader's figures pass through untouched instead.

**A third vacuous test, caught the same way and worth naming because the
method is the point.** The `job_photos` test claimed to pin "reports when
the photo was TAKEN" — and the mutation swapping `capturedAt` for the share
date PASSED it. In that fixture the newest-captured photo also had the
newest share date, so the two answers were identical and the assertion
could not see the difference it claimed to guard. The fixture now shares an
older photo LATER than the newest capture, so the mutation produces a
different date and fails. Running the mutation is what found it; the test
was green and meaningless until then.

**A gap found on the way, and left as a gap rather than papered over.**
`TmTicket` — the T&M ticket with an on-site signature — has **no web page at
all**, only `app/api/v1/jobs/[id]/tickets`. A foreman can capture a signed
T&M ticket on a phone and nobody can see it on a laptop. No tool was written
for it, because every tool here cites a page and that citation would have
been a dead link. It wants a page before it wants an assistant.

**Not verified, and not claimed:** none of the fifteen has been asked a real
question through the box. The tests fake the rows, so they prove the rules and not the
Prisma queries that feed them — in particular the `orderBy revisionNumber
desc, take 1` that selects a submittal's latest revision is asserted by
nothing here, because the fixture holds what that query would return.
