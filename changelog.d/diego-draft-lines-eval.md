### The draft-estimate drafter now has an instrument, and it immediately found something (Diego)
`diego/draft-lines-eval`

`FEATURE-AUDIT.md` carries "draft estimate line items from text" as Built, and it
is. What it had no instrument for was whether the output is any good. The only
test touching it was a ROUTING case (`lib/ask/eval/cases.ts`, `cmd-draft-lines`),
which proves the assistant picks the command and says nothing whatever about what
the command then produces. An audit of the estimating lane on 2026-10-01 put this
feature at 3 of 4 — prompt, gated caller, UI control, no output eval.

**The failure the eval is built around, because it is the one no code can reach.**
`draftEstimateLineItems` already downgrades a `catalogEntryId` the model invented,
and a `COMPANY_CATALOG` basis with no verified entry behind it. A catalog id that
is REAL but describes different work survives every one of those guards: the id
resolves, the foreign key is valid, nothing is missing, and the badge reads
COMPANY_CATALOG — the strongest basis the UI shows. `draft-lines.ts` then copies
that entry's unit price, budgeted cost, labour hours, craft and cost category onto
the line, so **one wrong match writes five wrong fields and labels them
trustworthy.** The system prompt names this exact case ('a catalog entry for 5/8"
type X board is not a match for acoustic ceiling tile'), which is the reason to
measure it rather than assume it: a rule stated in a prompt is a hope until
something scores it.

Fatal and reported are split on one rule — fatal is where the estimator cannot
catch it. Over-claimed basis, a priced line for another trade's scope, and a price
with nothing behind it are fatal. A catch-all line and a quoted price that drifts
from the catalog's own are reported, because the estimator sees both.

**The run, on Opus 5, which is what `modelFor` resolves for this feature:**

    draft-lines eval (draft-estimate-lines.1, claude-opus-5): requested 7, returned 7
      false confidence: 0 OVERCLAIMED
      scope:            0 priced another trade's work, 0 INVENTED a price
      silence:          6 of 18 lines carried NO PRICE; 2 cases where a price was
                        available and none was given

`requested 7, returned 7` first, so the numbers are over the whole suite rather
than over however many cases survived.

**AND THE FIRST RUN WAS GREEN WHILE HIDING ITS OWN BEST FINDING, WHICH IS THE PART
WORTH READING.** That run reported 0 over-claimed, 0 invented, nothing else — and
its basis tally showed 11 of 19 lines came back with **no price at all**, including
all five lines of a 5,500 sq ft EIFS scope with a stated build-up. The case
asserted `allowedBases: ["GENERAL_KNOWLEDGE"]` and passed, because a null basis has
no basis to constrain: it asserted a basis and examined none.

So a drafter that priced NOTHING, ever, would have scored a flawless run. That is
CLAUDE.md's own rule — absence of a failure is not a pass — arriving inside the
guard written to apply it, which is why it is recorded here rather than quietly
fixed. The eval now counts unpriced lines, flags a case where a price was available
and none was given, and **prints when its own `allowedBases` check examined
nothing**. Reported, never fatal: a missing price is the safe direction, the
estimator types one in, and that is what they did before this feature existed.

**What the instrument says about the model, stated as one sample and not more.**
Zero over-claims on both runs, and the near-miss ceiling case was resisted
correctly both times — it declined the drywall entry and still got
`ACOUSTICAL_CEILINGS` right. Reproduced on both runs: it declines to price work it
has no catalog or won-bid basis for, even where general market knowledge plainly
applies, and it never reached for `HISTORICAL_BID` once despite being handed two
won fireproofing bids. Line counts moved between runs (19 then 18), so the shape is
one sample per case; the no-price result is 2 for 2 on those two cases. Whether the
prompt should push harder on rule 3 is a product decision with its own evidence,
not a change made in passing — which is what the version is for.

**The cases are checked for free before anybody pays Opus to run against them**
(`draftLineCases.test.ts`, 11 tests, in CI at no cost). The plan-sheet eval shipped
with its most important case measuring nothing, because the trap sat where the
region filter removed it. The same failure is available twice here and both read as
a clean run: a `foreignScope` term the case's own scope text never mentions (the
drafter cannot price glazing it was never shown, so the assertion can only pass),
and a near-miss case with an empty catalog (no wrong match to resist, and the
downgrade guarantees the pass). Both are now build failures. Mutation-proven by
adding "roofing" to a scope that never mentions it — red, naming the case and the
term.

**Three prompt versions, not the one this needed, and the census is why.**
`promptVersionCensus.test.ts` derives the versioned features per FILE: a file
declaring a `*_PROMPT_VERSION` and resolving features with `modelFor(...)` has a
versioned prompt for every feature it resolves. That was exactly right while every
versioned prompt lived in a single-feature file — `planSheets.ts`, `addenda.ts`,
`quotes.ts`, `leads.ts`, `research.ts` and `ask.ts` are one apiece. `anthropic.ts`
is the only file holding three.

Proved by doing it rather than predicted: versioning the draft prompt alone turned
the census red, naming `billing.ts` recording `wip-narrative` and `compliance.ts`
recording `compliance-extract` without a version. The alternative was splitting a
150-line function into its own module to dodge a guard that was right. So all three
are versioned and all three usage records carry it, which closes the attribution
gap on two features nobody had got to. Mutation-proven: removing the one line from
`draft-lines.ts` reds the census and names the file.

Checked: `typecheck`, `lint`, and 8,444 unit tests over 531 files, all green. The
eval is run by hand with a key and is not in CI, like every other `*.eval.ts` here
— `pnpm eval:draft-lines`, or put the key in `apps/web/.env` once and run it with
nothing in front of it.
