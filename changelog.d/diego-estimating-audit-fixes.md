### The proposal said nothing when its prices had never met the markup (Diego)
`diego/estimating-audit-fixes`

An audit of the full estimating workflow on 2026-10-02 — seven stages, every
claim verified against source rather than against `FEATURE-AUDIT.md` — turned up
one defect that reaches a customer and three claims that had gone false. This is
those four. The remaining gaps the audit found are listed at the bottom, scoped
and deliberately NOT built.

**THE ONE THAT MATTERS: a GC-facing document that quietly omits the markup.**

`/jobs/[id]/proposal` is the bid a sub sends: scope, a schedule of values, a
total, and the exclusions `proposals.prisma` calls *"the spine of a sub's bid"*.
Its total is `Σ (quantity × unitPrice)` over the live line items — and the page
**read `JobBidRecap` nowhere at all**, verified by grep as zero references.

So a bid could carry a fully configured recap — markup per cost type,
escalation, material tax, overhead, profit, bond, contingency, the whole
seven-step pipeline — and the document that went to the general contractor showed
**none of it**, unless somebody had remembered to press "Apply to line prices" on
the estimate tab first. Nothing on the page said so. `FEATURE-AUDIT.md` conceded
the same gap in one clause — *"Still not yet: the GC-facing proposal printing the
marked-up total"* — which undersells it: the risk is not a missing feature, it is
a number a customer acts on being quietly low.

**IT DOES NOT PRINT THE RECAP TOTAL INSTEAD, and that was the first idea.** The
schedule of values is a table of line prices a GC will add up. Substituting a
different grand total under it produces a document that does not reconcile with
itself — and a GC who adds the column and gets a different answer has found a
reason to distrust every other number on the page. That is worse than the defect.
`applyBidRecap` already does this correctly: `spreadToLines` raises each line
pro-rata, largest-remainder-first for the cents, so lines and total move together.

So the fix invents no figure. `lib/estimating/proposal-recap-currency.ts` answers
one question and the page shows a sentence — `bid-recap.ts`'s own rule applied one
surface further on: *"the thing that cannot be computed is named on screen
instead of invented."* The warning is `print:hidden`, addressed to the sender and
never to the GC: a note on the printed page would be telling a customer our prices
may be wrong, which is a different and much worse sentence.

**It catches the second case too, which is the easier one to miss.** Applying the
recap and then editing a line is ordinary estimating, and the moment it happens
the prices are part marked-up with `appliedAt` still set — so a check asking only
"has it ever been applied" would call that document current. `appliedTotal`
against the live line sum is what makes it visible, compared in CENTS because
`spreadToLines` is exact to the cent and a tolerance would hide exactly the
one-line edit this exists to find. Mutation-proven: a $10,000 tolerance reds that
test and nothing else.

**Three claims that had gone false**, each corrected with what it used to say:

`jobs.prisma` on `JobLineItem.costCategory` read *"Equipment has no member of
CostCategory today and sits under OTHER."* **EQUIPMENT is a member of that enum
four hundred lines below the comment, in the same file**, and
`equipmentMarkupPercent` has its own recap rate. False since 2026-09-26.
`FEATURE-AUDIT.md` recorded striking the equivalent prose when the member landed;
this comment was missed — the ordinary way a correction goes half-done.

`bid-recap.prisma` said the applied columns *"refuse to apply the same recap
twice."* Nothing refuses anything, and **the header of that same file says so
eighty lines above** — *"`applyBidRecap` has never read `appliedAt`"* — so the file
contradicted itself. Safety comes from IDEMPOTENCE, not a guard. The distinction
is worth keeping because the takeoff path next door really does guard
(`TakeoffMeasurement.postedAt`, a hard refusal before any write), and reading
these as the same kind of protection would be wrong about both.

`estimate-stage.ts` labels an estimate **READY_TO_SEND** on `lineItemCount > 0`
with no signature request, and nothing else. It consults no recap, no
`bid-responsiveness.ts`, no `takeoff-currency.ts` and no cost figure — so a job
whose every line carries a price and no cost reads $0 direct cost to the recap and
"Ready to send" here. The label is not renamed, deliberately: the words are useful
on the jobs list, and the fix for an overstated label is to say what is behind it.
`estimate-stage.test.ts` now pins the list of what it does not check, including
the function's own arity, so widening it without widening the label fails.

---

**What the audit found and this PR deliberately does NOT build**, so the next
person starts from a list rather than from the code:

*Needs an external credential:* CAD/BIM import (the app already speaks Autodesk
Platform Services for ACC, but at `data:read account:read` — Model Derivative
needs write scopes, which widens a deliberately narrow promise); supplier pricing
(no distributor API exists; RSMeans via Gordian is the paid option);
per-jurisdiction sales tax.

*Needs a product decision:* target margin (there is no field, so "is this bid
sane" has nothing to compare against); which indirects to line-item
(`mobilization` has zero hits repo-wide); whether contingency needs weighted risk
factors; how retainage carry is priced.

*Needs clicking, so not done unsupervised:* `addLineItem` and `updateLineItem`
collect no `costCategory`, making the manual form the last path producing an
uncoded line — visible rather than silent, since `directCostByCategory` reports
them and the recap panel offers to code each one, but a second step on every
hand-typed line. The action half alone would be a field no form sends, which is
the "written, documented, never called" shape this repo punishes. Same for
grouping the sheet index by discipline, where the value is already captured and
normalised and only a query and a view are missing.

*Deliberate refusals, not gaps:* volumes (the three-primitive vocabulary is closed
on purpose — though spray fireproofing is priced on area × thickness, which is
worth re-arguing), levelled-quote-to-estimate-line, equipment cost into job
costing, sheet-gap detection.

Checked: `typecheck`, `lint`, **546 test files and 8,575 unit tests passing.** No
migration, no schema change, no new dependency — the two `.prisma` edits are
comments only.
