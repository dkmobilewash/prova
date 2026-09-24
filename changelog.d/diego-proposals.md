### A bid proposal with structured exclusions, not retyped prose (Diego)
`diego/proposals`

A sub's bid is scope, price and exclusions, and the exclusions are what
defend it against a GC's scope sheet. Prova had the price and the scope and
no document to send, and nowhere to keep the "not in our number" lines a
contractor types on every bid. The competitive audit found only Procore
treating exclusions as structured data; everyone else hands you a text box.

`/proposals` is the company's clause library — inclusions, exclusions,
clarifications, alternates. `/jobs/[id]/proposal`, reached from the Estimate
tab, is the document: scope, the live schedule of values with a bid total,
and the clauses grouped under their headings, printed through the browser
like the G702/G703. A clause on a job's proposal is a copy taken when it was
added (`JobProposalClause`), so rewording or deleting the library clause
later never changes a proposal a GC already holds.

The check: `lib/actions/proposals.test.ts` edits and then deletes a library
clause after putting it on a proposal and reads the proposal's row back
unchanged; it also pins that every refusal is returned rather than thrown,
that another company's clause or job is never matched (mutation-tested by
dropping `companyId` from the library lookup — red), and that the owner-only
delete removes nothing when refused. `action-capability-guards.test.ts` runs
all five actions as a principal without MANAGE_ESTIMATING.

`JobProposalClause` is a RESTRICT child of `Job`, so it is in
`HANDLED_MODELS` and both cleanup scripts' delete order — the #227 shape.
Both tables are in the data export. Additive migration only.

Not built: priced alternates, a sent/locked proposal, clause versioning.
