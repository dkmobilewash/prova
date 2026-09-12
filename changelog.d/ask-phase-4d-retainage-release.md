### The Ask box logs a retainage release — phase 4d, the last money command the billing exclusions were holding back, with the job page's own three figures on the card and a tap that re-reads them (Diego)
`claude/prova-ai-task-completion-96pjes`

"Release 12,500 of retainage on Riverside" and "release the retainage
held on Riverside" now produce a card headed "Log the retainage release"
with seven lines — Job, Withheld to date, Released to date, Still held,
This release, Held after, Released on (plus Note when one was said) — and
a button "Log release". The tap writes a `RetainageRelease` row through a
lifted core, `lib/billing/retainage-release.ts`, and the job page's
Retainage panel shows the new figures afterwards, exactly as the "Log
release" form at the foot of that section would have logged it.

**The exclusion this replaces**, from `lib/ask/commands/billing.ts`,
quoted exactly: `{ action: "createRetainageRelease", reason: "Money
released against the whole job's withheld balance, with an entered date;
a later phase once a card can show the balance it draws down." }`. Phase
3's cards showed a balance owing and a retainage withheld computed by the
app's own arithmetic, so the condition was met; the line is gone and the
action is registered. `deleteRetainageRelease` and
`updateJobRetainageTerms` keep their exclusions.

**What a release is here, read rather than assumed.** A lump sum the GC
paid back against the job's WHOLE withheld balance — never against one
invoice, which is a `Payment`. The job page's panel shows Total withheld
/ Total released / Outstanding balance from `calculateRetainageSummary`
over every invoice's snapshot (`Invoice.retainageWithheld`) and every
release's amount. The card's first three money lines are that same call
over that same read (`loadJobRetainage`, per job, listed in the retainage
census with its reason), so the card cannot disagree with the panel
beneath it; the two it adds are this release and the balance after, both
in the cents the comparisons run in.

**The action had no ceiling, and the form still has none — on purpose.**
`createRetainageRelease` accepted any amount, and the per-job balance is
signed by design (`lib/retainage.ts` pins a negative one): a sub whose
invoices predate this app has no snapshots to release against and still
has to log the cheque the GC actually sent. So the ceiling is the CORE's
option, `refuseOverRelease`, which the card sets and the form does not —
the same shape as `reuseOpenDuplicate` on the bid core. The resolver
refuses an over-release before any card exists, in the core's sentence,
which is logPayment's own shape for an overpayment ("That would bring
total released to $8,500.00, more than the $7,500.00 withheld on
Riverside. Only $5,000.00 is still held."), and the core refuses it again
on the tap regardless. A reviewer who wants the form to refuse too flips
one option in the action.

**The model never supplies a figure.** The amount is the person's own
digits through `lib/ask/numbers.ts` — "12,500" and "$12,500.00" are one
amount, "12.5k" and "half" are a question back that names the balance it
could release instead — or NO figure at all: "the retainage held", "the
balance", "all of it" (a short list of words, `asksForAllOfIt`, pinned in
a table) mean the full balance the app just computed, and the card's This
release line says "— the full balance held". An omitted amount means the
same, which is the one decision here a reviewer might overrule: the card
says so in words and the person reads it before tapping, but a model
that forgot the figure would offer the full balance rather than ask.

**The date is entered, not stamped**, as the form's date field is. The
person's words go through `parseDateWords` against their own today: a
relative phrase is a question back (a new row has nothing to count from),
anything unreadable is a question quoting the words, and a day ahead of
today is carded with a warning. A month-day already past this year is
THIS year, where the bid and schedule commands offer a which-year chip
row — the schema's words for this row are "retainage actually paid
back", so "September 8" said on the 11th is three days ago and never next
year, and the year is on the card regardless. No words means today — the
person's calendar day, not the server's clock — and the card says
"today; say a date if the GC released it on another day" beside it.

**The tap re-checks.** The payload carries `expectedBalance`, the balance
the card was made from. The write is an INSERT, so there is no row to
compare-and-set the way `job-schedule.ts` does; instead the core re-reads
the job's invoices and releases INSIDE the transaction and compares
before inserting, and the transaction runs SERIALIZABLE so two releases
against one job cannot both read the same balance and both land —
Postgres aborts one with a serialization failure (Prisma P2034), which
comes back as a sentence rather than a second release. A stale card is
refused naming all three figures the job holds now. Serializable is the
second decision a reviewer might overrule; READ COMMITTED with the same
re-read would still catch a release that landed before the tap, just not
two taps in the same instant.

**Capability.** MANAGE_BILLING — `showsBilling` on the job page is
`can(principal, "MANAGE_BILLING")`, and that is the whole gate on the
Retainage section. ACCOUNTING and PROJECT_MANAGER are offered it, FIELD
and ESTIMATOR are not, and `confirmAskProposal` refuses a member without
it in a returned sentence before anything is claimed. The action itself
still asserts no capability, like `createInvoice` and `logPayment` beside
it: the job page is open by design (`lib/action-capability-guards.test.ts`
records why), and the card's write path is the confirm action, which does
check. The core takes no principal, like the three cores before it.

**What the tests pin.** `billing/retainage-release.test.ts`: both tables
read scoped to the job, the summary deep-equal to the page's own call over
the same rows, the exact `create` data and the isolation level, "Job not
found" before any row is read, the form path releasing MORE than is held
with neither option set, the ceiling and the stale sentences verbatim
with nothing written, cents comparison ("5000" is "5000.00"), and P2034
as a sentence while any other error still throws.
`commands/retainage.test.ts` runs `resolve` against faked ROWS, not a
faked read, so the seven preview lines and the exact payload come through
the real per-job arithmetic: the question before any read, the estimate
refusal before any retainage row, the three "nothing held" sentences, the
amount question naming the balance, the pre-card over-release refusal,
the full balance in words and by omission, "nothing yet" on a first
release, the date in the person's words with the future warning, chips
and both question shapes, a chip's job re-read by id, and on `execute` the
exact core arguments including `expectedBalance` and `refuseOverRelease`.
`asksForAllOfIt` has its own table both ways. `audit.test.ts` pins the
`/settings/assistant` link for a `RetainageRelease` target — "Retainage
release", to its job page, looked up in one query per kind like the time
entries — which the bid invitation of phase 4c never got and still lacks.
`commands.test.ts` pins
ACCOUNTING gaining `release_retainage` as its third money command, FIELD
and ESTIMATOR not, T3, DIRECT, the core's name, and the delete still
excluded. `commands.coverage.test.ts` sees `createRetainageRelease` leave
the exclusions for a registration. `retainage-single-source.test.ts`
gains the core and the two tests that fake its rows, each with its
reason. The eval gains three `release_retainage` cases (a figure, the
balance in words, an ACCOUNTING member with a date and a check number)
and two `no_command` cases (FIELD asking for one; "remove the retainage
release logged on Riverside last week"). `lib/actions/ask.dbtest.ts`
proves the tap against a real Postgres: a FIELD member refused in a
sentence with nothing written, the row landing with the form's own fields
and the card's calendar day, a card made from the old balance refused
with the current three figures, $6,000 against $5,000 refused by the
core's ceiling, the full balance clearing it to zero, and
`loadJobRetainage` over the same rows agreeing with every figure the
sentences named.

**Not clicked, and the database test was not run from here.** The scratch
Postgres 16 was not running in the container this was built in, so the
`ask.dbtest.ts` case above is written and typechecked but has not been
executed against real rows; it is the first thing to run. Nobody has
loaded a page with this on it, and the routing eval was not run. Whether
the model omits `amount` for "the retainage held" rather than passing the
phrase (both resolve to the full balance) is asserted by the schema
description and the eval cases, not yet observed. The click list, on a
preview signed in as OWNER on the Development Clerk instance (the demo
database — pick a contracted job whose Retainage panel shows an
Outstanding balance above zero; seed-demo's jobs at a 10% rate have one;
call it J, and its GC G):

1. `/jobs/<J>` → Retainage. Write down Total withheld (W), Total released
   (R), Outstanding balance (B), how many invoices in the Invoices section
   show "Retainage withheld this invoice" (N), and how many rows are in
   the releases list (M).
2. Dashboard → ask "release 100 of retainage on J". Expect a card headed
   "Log the retainage release" with exactly: Job "J · G", Withheld to date
   "W across N invoices", Released to date "R across M releases" (or
   "nothing yet" when M is 0), Still held "B", This release "$100.00",
   Held after "B minus $100.00", Released on "<today's date> (<weekday>) —
   today; say a date if the GC released it on another day", and a button
   "Log release". Any of W, R, B differing from step 1 by a cent is a
   failure. No card is a failure.
3. Tap it. Expect "Released $100.00 of retainage on J; <B minus $100.00>
   is still held." with a link "Retainage release, J". Reload `/jobs/<J>`:
   Total released is R + $100.00, Outstanding balance is B − $100.00, and
   the releases list has a new row dated today for $100.00.
4. Ask "release <B + 1,000, as digits> of retainage on J". Expect NO card
   and the sentence "That would bring total released to <R + 100 + B +
   1,000>, more than the W withheld on J. Only <B − 100> is still held."
   Any card is a failure; the panel is unchanged.
5. Ask "release 12.5k of retainage on J". Expect NO card and a question
   for the amount as a plain number, quoting "12.5k" and offering "all of
   it" for the balance it names. Any card, or any figure it picked for
   you, is a failure.
6. Ask "release 25 of retainage on J, released 9/8". Expect Released on
   "Sep 8, 2026 (Tuesday)" with no "today" after it. Tap; the job page's
   new row reads "Sep 8, 2026". A row dated today is a failure.
7. Stale card: ask "release 50 of retainage on J" and DO NOT tap. In a
   second tab, on the job page's own "Log release" form, log 1.00. Back
   in the first tab, tap Log release. Expect "J's retainage has changed
   since you last saw it — W withheld, <R + 126.00> released, <B − 126.00>
   still held. Ask again to see the balance before releasing against it."
   and NO $50.00 row on the job page. A $50.00 row is a failure.
8. Ask "release the retainage held on J". Expect This release "<the
   panel's current Outstanding balance> — the full balance held" and Held
   after "nothing — this clears it". Tap; expect "…; nothing is still
   held." and the job page's Outstanding balance $0.00 in green.
9. Ask the same sentence again. Expect NO card and "All W of retainage
   withheld on J has already been released — nothing is held."
10. Ask "release 100 of retainage on <an ESTIMATE-stage job>". Expect NO
    card and "<its name> is still an estimate — nothing has been invoiced
    on it, so no retainage is held."
11. In a browser signed in as a MEMBER with job function FIELD, ask step
    2's question. Expect no card and a sentence that it needs billing
    access (MANAGE_BILLING).
