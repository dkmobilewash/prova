### The scope letter's expensive failure is silence (Diego)
`diego/proposal-gap-closer`

The estimating audit's stage 5.2 asks for *"project-specific scope summaries,
inclusions and explicit exclusions"*. The proposal page was already good — a
schedule of values from the live line items, clauses grouped by kind, the recap
warning — and `ProposalClause` gave a company library that **ships empty because
nothing ever drafted anything**.

**This is not prose generation, and the reason is what a scope letter is.** It is
a risk document. If Division 09 demands Level 5 at the lobbies and the letter
does not mention it, the GC assumes it was priced. If Division 01 restricts work
to night shift and the letter says nothing, the sub eats the premium. The price
is one line; the letter decides who pays when the GC says "that was your scope".

So code finds every fact the app ALREADY KNOWS that the letter is silent about,
and the model writes one sentence per gap, **citing the quote it came from**.

| source | fact | clause |
| --- | --- | --- |
| `BidSpecReading.findings` | a requirement, with its quote and page | both sentences — see below |
| `missingIndirects` | nothing carries dumpsters | an EXCLUSION, confidently |
| carried `BidQuote` | a package the estimate does not carry | an INCLUSION naming it |
| `BidAddendum` | which addenda the bid used | a CLARIFICATION |

## `factRef` is why there is a new table

**Coverage is DECLARED, never inferred.** A fact is answered when a draft
carrying its ref exists — not when some clause happens to contain the words
"Level 5". Text matching is what this repo refuses everywhere else
(`costCategory`, `craftClassificationId`, the takeoff recipes), and here it fails
in the direction that costs money: *"Level 5 finish IS included"* and *"Level 5
finish is NOT included"* contain the same words, and a check built on words
cannot tell those apart.

**DISMISSED is a recorded status, not a deleted row.** An estimator who decided a
requirement does not belong on this letter is never asked again. Without that the
panel is a nag, and a nag is a panel people stop reading.

## One honest correction to my own brief

Diego chose *"draft an EXCLUSION, and say it is unpriced"* for a requirement
nothing priced. **The app cannot tell priced from unpriced for a spec finding** —
matching "Level 5 finish at public areas" to a line item means reading line text
for meaning. Claiming it would be #630's cry-wolf failure with a legal document
attached.

So the rule splits by what is knowable. `missingIndirects` and carried quotes are
declared checks and get a confident clause. A spec finding gets **both**
sentences, as two rows sharing one `factRef`, grouped under one citation with
"this app cannot tell whether your number carries this — pick the one that is
true". That is why there is deliberately **no unique index on `factRef`**: a
unique index would have made the pair unrepresentable.

## A review step, which `draft-lines.ts` deliberately does not have

That module writes `jobLineItem.createMany` straight out of model output, and it
is right to — a line item is a number on a screen somebody can see and change.
An exclusion is a sentence sent to a GC. So accepting creates the
`JobProposalClause` snapshot and the draft records who accepted it, **in one
transaction**: a clause on the letter whose draft still reads PROPOSED gets
offered again, and a draft marked accepted with no clause behind it is a fact the
queue thinks is answered and the letter does not mention.

The citation sits **above** the sentence, not below it and not behind a
disclosure, because the question being answered is "is this true of my number?"
and the drafted wording alone cannot tell you.

## Verification

- **21 unit tests** on the pure module, **mutation-proved both directions**:
  never-covered reds 3, always-covered reds 3. Heavy on the two that decide the
  product — `priced` is NULL for a spec finding and never false, and a dismissed
  fact stays dismissed.
- **11 tests against a real Postgres** on the actions, because "did one clause
  get created, once, and did the draft move with it" is a claim about rows. A
  second accept is refused rather than adding the clause twice; the EDITED
  wording from the form is what lands; another company cannot reach any of it.
- `typecheck` 5/5, `lint` 5/5, **580 files / 9,001 unit tests**, db suite
  **66 files / 655 tests** with the migration named in the log.
- Announced in `#prova-build` before the push, per rule 4.

**Four censuses refused this before it was finished, and every one was right.**
`aiSurfaceCensus` — no control, no feature. `commands.coverage` — every action
registered or excluded, and `proposalDrafts.*` is excluded because a clause is a
sentence sent to a GC and accepting one could not be a prompt.
`exportCompletenessCensus` — the new model needed a bucket.

And `action-capability-guards` caught **two** things, the second more useful than
the first: I guarded on `VIEW_JOB_COSTS` where the page gates on
`MANAGE_ESTIMATING` (seeing money is a different question from writing a bid) —
*and* that my refusal SENTENCE was not the house one. That census recognises a
capability refusal by matching `/part of your job function/`, so a refusal
phrased any other way reads to it as **no refusal at all**. The sentence is also
what a person reads, and every other estimating action says it the same way.

## What this deliberately does not do

- **No cover-letter prose.** "We are pleased to submit" is not where a bid is won.
- **No claim the letter is finished.** The panel says "nothing this app can see is
  missing" and then, in the same breath, *"that is not the same as a complete
  letter — it has not read the GC's scope sheet"*. `bid-responsiveness.ts`'s rule:
  there is no compliant verdict, deliberately.
- **`drawingBasis` is wired to null on purpose.** `takeoff-currency.ts` can say
  which revision the quantities came from, and that belongs on a letter — but it
  answers in plans and revisions rather than one label and date, and mapping it
  needs a decision about what to say when a job has three plans at different
  revisions. A fact nobody can state precisely is worse than one the letter does
  not carry yet.
- **The model half is unmeasured.** There is no eval for the clause writer, so
  whether it holds rule 1 — never state a fact the input did not carry — is
  unproved. `parseDraftedClauses` enforces the structural half by dropping any
  clause whose `factRef` was not sent, which is the part a prompt cannot. The
  eval is the next thing to run.
