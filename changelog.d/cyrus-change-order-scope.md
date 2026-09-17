### What a priced change order request actually says (Cyrus)
`cyrus/change-order-scope`

A construction manager read a real PCO out on a recorded walkthrough. Its
scope section was five sentences, and only the first was the work:

    Furnish and install 3/4 inch FRT APA plywood at catwalk
    Temporary dance floor to be provided BY OTHERS
    Hecklift provided BY OTHERS, to be used for stocking materials
    Top of dance floor to be no more than three feet below catwalk
    Steel angle figured at continuous perimeter

Two exclusions, an assumption, and how it was priced. **The exclusions are
the sub's whole defence**: months later the GC says the dance floor was in
your number, and the only thing that settles it is a document that says, in
its own labelled section, that it was not. Before this branch all five
sentences went into one `description` field, if they were recorded at all —
and a sentence in the middle of a paragraph is an argument, where the same
sentence under a heading reading "NOT included — by others" is a term.

**Structured, not free text, and here is the line that was drawn.** The
tempting version adds eight columns and nobody fills any of them in. The
version here adds exactly ONE structured field — `kind`, four values — and
leaves the sentence itself as the sentence the estimator would have typed
anyway. He still types it at 6pm in his own words; he says which of four
things it is, from a dropdown, and the document does the rest. Nothing is
parsed, ranked or validated. That is the whole judgment call: the structure
buys a separate heading on the page and a machine-readable split for the GC
portal later, and it costs one select.

The four kinds are four different answers a GC can demand six months later —
"is X in this price?" (yes / no), "why is it more now?" (a stated condition
changed), "how did you get to that?" (what the number was figured on). The
last two look alike and are not: an assumption failing is the GROUND for
another change order; a pricing basis explains arithmetic and grounds
nothing. Both were on his document, separately.

**No new table holds priced lines, which ARCHITECTURE.md required checking
before anything else here.** `ChangeOrderProposal` already is the one place
a change order's money lives before approval, and `JobLineItem` after it.
`ChangeOrderScopeNote` has no quantity, no price and no subtotal — it is
text and a tag. An INCLUSION note qualifies the priced lines in words; it
never restates their value, and the "Scope of work" block on the card is
still the proposals themselves, now with a heading over it.

**His labour breakdown, which is the other half.** Cut-and-install as one
line, foreman at a percentage of it, stocking and cleanup on its own,
materials broken out separately. That needed one nullable column —
`ChangeOrderProposal.costCategory`, reusing the existing `CostCategory`
enum so "labour" means one thing across the app — and a pure `laborBreakout`
that groups the proposals the way a PCO presents them. Blank is a real
answer and stays null: a lump-sum line has genuinely not said which side it
is on, and folding it into OTHER puts money in a bucket nobody chose, so it
gets its own "not broken out" row.

Deliberately NOT copied onto `JobLineItem` on approval. That would mean
adding a cost category to contract value, WIP and every estimating read for
a field describing how a CHANGE ORDER was priced rather than what the budget
line is. The proposal is the pricing record of the document that was sent;
the line item is the scope that was agreed.

**The foreman percentage records a basis, and does not compute a price.**
`foremanPercent` sits on the foreman's own labour line. The dollar figure
stays in quantity x unit price like every other line, because a change order
is an offer: once the GC holds it, the allowance is a fixed amount they
agreed to, not a formula that re-evaluates when somebody edits a labour line
next week. So the breakout derives what the percentage COMES TO and prints
both — "10% of $4,000.00 is $400.00" — and `foremanOutOfStep` says so in
words when they stop agreeing, which is what happens when $1,000 of crew
time is added after the foreman line was priced. Storing the derived amount
would have hidden exactly that. The foreman line is excluded from its own
base, or 10% would be figured on money that includes it.

**Every bucket reconciles to the number already on the card.** Labour
(crew + foreman) plus material plus subcontractor plus other plus
not-broken-out plus changes-to-existing-scope equals
`changeOrderValueDelta` for the same inputs. A breakout that reconciles to
nothing is a second set of books, so that equality is a test rather than a
hope.

**The exclusions reach the GC, or none of this is worth anything.** The
portal showed an approved change order as its number, title and free-text
description, and nothing else — so a feature justified entirely by "the
document you both hold says it was excluded" would have shipped with the
exclusions visible only on the sub's own screen. That is a note to self, not
a term. `/portal/[token]/jobs/[jobId]` now loads `scopeNotes` with the change
orders it already shows and renders them through the SAME `scopeSections()`
the internal page uses, so there is no second rendering path that could fold
an exclusion back into the scope of work on the one copy where it matters.
Read-only and safe by construction: that query is APPROVED-only already, and
notes are editable only while a change order is DRAFT, so what the GC sees is
frozen. Two mutations cover it, below.

**Checks.** The migration is hand-written (`prisma migrate dev` cannot run
against this dev database — pre-existing drift on
`20260831060000_add_equipment_assignment_history`, and its only offer is a
reset) and additive only: one enum, one table, two nullable columns. Every
statement is on one line, and the foreign-key census in
`scratch-cleanup-order.test.ts` parses 197 of a literal 197 with
`ChangeOrderScopeNote.changeOrderId -> ChangeOrder CASCADE` in the set — a
CASCADE child blocks no parent delete, so neither cleanup script needed an
edit, unlike `InvoiceCounter` (#227).

Eight mutations, each broken, watched red, restored, watched green. The
counts are the failing-test totals actually printed by the run, not
estimates:

| mutation | result |
| --- | --- |
| `scopeSections` drops its kind filter — every note in every section | RED, 6 across both files |
| foreman line left inside its own base | RED, 10 |
| `labor = laborBase`, foreman dropped from the subtotal | RED, 5 |
| uncategorised dropped from the reconciled total | RED, 1 |
| `EXCLUSION` heading reworded to "Scope of work" | RED, 2 |
| my migration's FK corrupted so the census cannot parse it | RED, 1 — "declare 197 … parsed 196" |
| portal renders `co.scopeNotes` flat instead of split | RED, 1 |
| portal stops loading `scopeNotes` at all | RED, 1 |

The heading mutation is the one worth keeping. A component handed correctly
split sections can still label them in a way that gives an exclusion away —
"Scope of work" over the excluded items would be worse than no heading —
and the pure split tests stay green while it does. So
`changeOrderScope.test.ts` mounts the component in happy-dom, asks the DOM
which section each sentence landed in, requires the exclusion heading to
match `/not included/i`, and counts each sentence once so printing all five
notes four times cannot pass either. What it cannot see is layout; happy-dom
does none.

**One inherited claim was wrong and is corrected rather than repeated.** An
earlier draft of this entry reported the first mutation as 7 failing tests.
Re-run, it is 6. Nothing about the code changed between the two; the number
was simply never read off the run. It is recorded here because this file's
whole convention is that a number in a changelog is evidence, and evidence
nobody re-read is just a sentence.

**A ninth mutation failed to be a mutation, which is worth more than the
eight that worked.** The first attempt at corrupting the migration's foreign
key changed `ON DELETE CASCADE` to `ON DELETE CASCADEX` — and the census
stayed green on all 3,213 tests. Not because the guard is weak: the census
pattern is `ON DELETE (RESTRICT|CASCADE|…)` with no word boundary, so it
matched the `CASCADE` prefix and parsed the statement correctly anyway. The
guard was right and the mutation was vacuous. Breaking the parse for real
(unquoting the column) produced the intended red. A mutation that does not
go red has two explanations — the test is blind, or the mutation did not
change behaviour — and assuming the first is how a working guard gets
"fixed".
