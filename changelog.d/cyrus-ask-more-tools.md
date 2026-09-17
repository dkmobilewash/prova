### Six more things the assistant can look up

`open_submittals`, `certification_expiry`, `apprentice_ratio`,
`closeout_status`, `fringe_remittance` and `backcharge_exposure`, taking the
read surface from fifteen tools to twenty-one. All six are reads — nothing
new can be written, and no command was added.

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

**Capabilities follow the page each cites**, which is the rule `tools.ts`
already states: `/submittals` is `MANAGE_JOBS`, `/certifications` is
`MANAGE_FIELD`, `/union-compliance` is `MANAGE_COMPLIANCE` (for both the ratio and the
remittance), `/closeout` is `MANAGE_JOBS`, `/backcharges` is
`MANAGE_BILLING` — a backcharge is money coming off the next cheque, so it
sits with whoever chases the cheque rather than with compliance. The second is worth naming — the question is "who can start
on Monday", which a foreman asks and a compliance manager does not.

**What adding a tool actually costs here, recorded because it is the good
news.** Four separate registries refused the change until each was updated:
the `ToolName` union, the `HANDLERS` map, `toolLabels`, and two test-side
censuses — one asserting every tool's capability matches its citation page,
one asserting every tool has at least one routing eval case. Nothing shipped
half-wired, and none of it needed remembering.

44 new tests. Eleven mutations watched RED and restored: counting never-sent
drafts as open, reporting `pastDue: false` where no date was agreed, dropping
undated certifications, returning nothing on an unreadable window, reading the
ratio verdict off `daysOver` alone, giving a verdict where no rule exists,
passing an unreadable month straight through, sorting the closeout blockers,
burying the unpriced remittance hours, counting settled backcharges as
exposure, and reporting `pastRespondBy: false` where no date was recorded.

**Two things writing the tests found, rather than the tests confirming what
was already right.** The backcharge summary counted `pastRespondBy` across
every row including SETTLED ones — a closed backcharge whose window lapsed
months ago is not something anyone can act on, and counting it inflates the
one number meant to make somebody move today. It counts the open ones now.
And the first version of the remittance total test computed a figure and
asserted it differed from another, which was a tautology that passed on
nothing; it asserts the loader's figures pass through untouched instead.

**Not verified, and not claimed:** none of the six has been asked a real
question through the box. The tests fake the rows, so they prove the rules and not the
Prisma queries that feed them — in particular the `orderBy revisionNumber
desc, take 1` that selects a submittal's latest revision is asserted by
nothing here, because the fixture holds what that query would return.
