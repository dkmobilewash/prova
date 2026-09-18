### Lien deadlines — a place to put the date, and nothing that works one out (Cyrus)
`cyrus/lien-deadlines`

*"When does our lien deadline run out on Riverside?"* was one of the six
questions the hundred-question census left with no answer, and the reason
was not a missing tool. There was **no lien, preliminary notice or stop
notice model in the app at all.** On California public work the
preliminary notice window is 20 days from first furnishing, and missing it
forfeits the remedy entirely — for a sub, the lien is the lever left when a
GC stops paying, and it is lost to a calendar rather than to a dispute.

**THE APP NEVER COMPUTES A LEGAL DEADLINE, and that is the design, not a
gap in it.** The rules change by state, by public versus private work and
by the contractor's tier, and a computed date that is wrong costs the whole
remedy in the same confident voice as one that is right. So every
`dueOn` is ENTERED by a person, from their counsel or the statute. There is
no state-rules table and no date arithmetic that produces a deadline — the
only arithmetic anywhere is the count of days between today and a date
somebody else decided. It is said in the schema comment, the page's
description and empty state, the Ask tool's description, and on every row
the tool returns (`deadlineSource: "entered"`). The deadline field is the
one date input in the app with **no default**, on purpose: a date the app
pre-filled is a date the app chose.

`LienDeadline` — job, kind (preliminary notice, mechanic's lien, stop
payment notice, bond claim, other + its name), the entered deadline, an
entered served date, who it goes to, a note. **Overdue, due soon and served
are derived, never stored** (`lib/lien-deadlines.ts`), and one rule is worth
naming: a notice served AFTER its entered date is still **served**, never
overdue — "overdue" would tell somebody to serve it again, and whether late
service still counts is for counsel. The row says so in those words.

A served row is the record: it is not re-served over (the "mark served"
write only matches unserved rows), not edited, and never deleted. The owner
can take a served date back off for a mis-click. A served date more than a
day in the future is refused, because a typo there shows an unserved notice
as served — the most expensive wrong answer this screen could give.

No unique key, deliberately: one job carries several preliminary notices due
the same day (owner, GC, lender are each served), so there is no P2002 to
catch and no `isUniqueConstraintError` branch.

**`/lien-deadlines`**, MANAGE_BILLING, in the Financials group beside
backcharges. Overdue unserved rows sort first and are marked in red with the
day count; then unserved by date; then served, newest first. The empty state
says an empty list means nothing has been ENTERED, not that no deadline is
running.

**`lien_deadlines` in the Ask box**, same capability as the page. The
census question moves from gap to tool (`CENSUS_GAPS` 6 -> 5), and the
KNOWN_GAPS entry for liens is **removed** — that list is injected into the
system prompt, so leaving it would have told the model to refuse the exact
question it can now answer. Restoring it failed nothing, which mutation
found, so a test now pins it. All five new actions are excluded from the
command registry with the reason: a command would put a MODEL in the
position of supplying a legal date.

The #227 edits, because a required `jobId` makes this a RESTRICT child of
`Job`: `HANDLED_MODELS`, and `del()` in both `clean-scratch-data.mjs` and
`seed-demo.mjs`. Removing either `del()` turns `scratch-cleanup-order.test.ts`
red. **Removing it from `HANDLED_MODELS` fails nothing** — that list is
deliberately partial (fifteen other blocking children are not in it) and its
guard is `clean-test-jobs.mjs` refusing by name at runtime. Recorded rather
than "fixed", because a test demanding the list be exhaustive would be wrong.

Migration `20260918110000_add_lien_deadlines`: additive, hand-written with
every statement on one line, and identical in content to what
`prisma migrate diff` generates from the schema change.

## Two cross-company writes no test guarded, found in review

Independent review deleted the company scope from every read and write in
`lib/actions/lienDeadlines.ts`, one at a time. Create, mark-served and delete
went red. **Edit and undo-served did not** — each passed all 3,830 tests. The
code was correct; a regression in either would have been invisible:

- without it, `updateLienDeadline` could rewrite **another company's**
  deadline date;
- without it, `clearLienDeadlineServed` could mark **another company's served
  notice** as unserved — erasing the record that a legal notice went out.

Both are now pinned against the existing `"theirs"` fixture, and both go red
on the mutation. They were the two the author's own mutation list did not
reach, which is the reason an author's "all caught" is where review starts.
