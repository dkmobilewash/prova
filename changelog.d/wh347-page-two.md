### What actually changed, in plain English (Cyrus)
`cyrus/seed-counters-zzbqtu`

**The WH-347 could not be filed by anybody, for any week, ever — and it said so
honestly, which is why nobody chased it.** `lib/wh347.ts` added
`statementOfCompliance` to `blocking` unconditionally, with a comment explaining
that page 2 was not built, so `fileable` was `false` on every week of every job
for every company since the module was written. Page 1 was real: hours in the
right boxes for the right days, deductions and net wages off the imported
register, a sequential payroll number. Page 2 — the certification a person signs
under penalty of perjury — did not exist, and without it page 1 is a very good
draft of a document nobody can send.

Page 2 exists now. `statementOfCompliance` clears when its facts are recorded,
so **`fileable` can be true for the first time.**

**That is the dangerous half, and it needed a guard nobody had written.** The
red banner at the top of the form was rendered UNCONDITIONALLY — no
`blocking.length > 0` around it. So the first week that ever cleared would have
printed *"This is not ready to file. 0 things are missing."* over an empty list:
a red panel reporting that nothing is wrong. Nothing could have caught it,
because no code path had ever produced an empty blocking list. There is a second
branch now, and it is the only new UI in this change that existed to be
impossible before.

**Three things page 2 needs that the app cannot derive, and one it refuses to.**

*Who signs it and their title* are entered, never taken from the session: the
person logged in is not necessarily the person who signs a federal
certification, and an owner, an office manager and a payroll clerk sign
different things.

*The section 4 fringe election* — whether fringe benefits went to approved
plans (4(a)) or were paid in cash with the wage (4(b)) — is entered because
`FringeRateSchedule` holds four RATE columns and **no column saying where the
money goes.** Inferring 4(a) from the existence of the fringe-remittance
feature, or from `fringeCreditFor` treating fringes as a credit, would be C
Stream asserting how a company pays its people, on a document that company
signs under penalty of perjury, off a column nobody ever asked that question of.

*A signature* is refused outright. There is no `signedAt`, no signature image
and no e-sign flow; the page prints a line for wet ink. This app holds an
e-signature capability, and using it here would put a row in the database
asserting that a named person certified a federal filing — a claim about a legal
act, and the wrong kind of thing for a checkbox to create.

**THE STATUTORY PROSE IS UNVERIFIED AND THE FORM SAYS SO, IN PRINT.** Not one
paragraph was read off a DOL page — `dol.gov` is unreachable from the container
this was written in — so `WH347_STATEMENT_CITATIONS` holds every paragraph with
`verified: false`, a primary URL and the question a human has to answer, and
`wh347-statement.test.ts` fails the build if one is flipped to true without a
source. The printed page carries the disclosure the pay application already
carries for being G702/G703-*style*: reproduced, not transcribed, read it
against the official form before signing. Unverified prose does **not** block —
it is disclosed, the way the pay app discloses its own — and there is a test
pinning that distinction, because it is the one most likely to be "fixed" by
mistake.

**`fileable` STILL could not have become true without one more column, and
finding that out is what changed the scope of this.** `contractNumber` blocked
unconditionally in practice: the header asks for it, the sentence beside it read
*"A job does not record one"* — true — and there was no such column anywhere in
the schema. Page 2 landing alone would have left the form one unfixable field
short of fileable, which is worse than being obviously unbuilt. `Job.contractNumber`
is the fifth entered public-works fact, on the Compliance tab beside the other
four, and the blocking sentence now says where to put it.

**Two censuses caught real bugs in this work, and one of them caught a defect I
would not have found by reading.** `formActionCensus` refused
`<form action={…}>`: in React 19 that resets the fields BEFORE the action runs,
so a returned refusal arrives over an emptied form — seven fields and every
exception row gone, and an error message about text no longer on screen. It is
`onSubmit` + `preventDefault` + `new FormData(event.currentTarget)` now, the
shape `LogTimeEntryForm` already used. `rowActionsCensus` flagged the same form
as a one-click destructive submit and cleared with it. `action-capability-guards`
found the new action by derivation and now executes it as a principal without
`MANAGE_COMPLIANCE` to prove the refusal. `exportCompletenessCensus` went red on
both new models until they had a bucket, and `exportColumnCensus` on the new
`Job` column — the fourth registration the `InvoiceCounter` three-edit scar does
not mention.

**`Wh347StatementException` is deliberately NOT in `HANDLED_MODELS`.** The loop
in `clean-test-jobs.mjs` issues `deleteMany({ where: { jobId } })` for every
model in that list and the exception has no `jobId` — it cascades from its
statement. Giving it one purely to satisfy a script would denormalise a column to
feed a cleanup loop. `scratch-cleanup-order.test.ts` agrees: a Cascade edge is
not a RESTRICT blocker, so it requires the statement in both `del()` orders and
does not ask for the exception.

**Not done, said plainly.** There is no dbtest for the new models: this container
has no Postgres, and a test whose first run is on CI is a claim rather than a
check. The static cleanup-order census covers the ordering and the database
constraints cover the rest. And `JOB_HISTORY_RELATIONS` in `lib/job-details.ts`
still omits every per-job WH-347 relation — its docblock claims "every other
relation on the model is here", `job-details.test.ts` pins a hardcoded
`toHaveLength(19)` rather than deriving from the schema, and about fifteen
relations are missing. I did not add mine, because fixing one of fifteen while
the count stays hardcoded is worse than leaving the gap visible. It is a
separate change and an issue.
