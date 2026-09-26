### The assistant can read the estimating work, and refuses where the data refuses (Cyrus)
`cyrus/ask-estimating-tools`

Thirteen estimating and takeoff features shipped between 22 and 26
September — plan takeoff, takeoff currency, wall types and the wall
schedule, production rates, estimate templates, proposal clauses, the
conceptual benchmark, bid alternates and unit prices and allowances,
addenda and bid-form compliance, bid levelling, the bid recap, and the
won-bid→job link. The Ask box could read **none** of them. Every question an
estimator asks in the week before a bid is due routed to nothing, or to the
near-miss beside it.

Seven read tools close it: `takeoff_currency`, `wall_schedule`,
`bid_levelling`, `bid_compliance`, `bid_alternates`, `bid_recap`,
`conceptual_estimate`.

**Three of them exist as much to refuse as to answer, and that is the
point.** `takeoff_currency` says "18 measurements came off Rev 2, issued
2026-09-04; Addendum 4 has been issued since — go and check what moved" and
never re-measures, because the app cannot see what moved on the new sheet
and a corrected quantity would be a guess printed beside real ones. A plan
with no issue date stays UNKNOWABLE rather than being called current, which
is the dangerous half of that guess. `bid_levelling` will not hand over a
cheapest figure without the caution naming what that quote excludes and the
others cover. `bid_compliance` has no compliant verdict at all: the
strongest sentence available says nothing is outstanding *that this app can
see*, because it has read what somebody typed in from the ITB and not the
ITB.

**The near-miss was the real hazard, not the silence.** `drawing_currency`
sounds like it covers the takeoff question and does not — it reads
`DrawingSet`/`DrawingRevision`, the job's paper trail, while the measured
sheet is `TakeoffPlan.revisionLabel`/`sheetIssuedOn`, compared by DATE
because `takeoff.prisma` says the two must not become each other. Same shape
with `estimate_detail`, which holds direct cost and no markup, against the
"what does that come to with overhead on it" question that belongs to
`bid_recap`. Both collisions are written into the eval cases on purpose.

**No figure is computed here.** Every one comes out of the library the screen
renders through — `lib/takeoff-currency.ts`, `lib/wall-assemblies.ts`,
`lib/bid-levelling.ts`, `lib/bid-responsiveness.ts`, `lib/bid-lines.ts`,
`lib/bid-recap.ts`, `lib/conceptual-estimate.ts` — and the sentences those
modules write are carried out verbatim rather than paraphrased, so the
refusal cannot be softened on the way to the model.

**The specific checks.** Seven handler test files, each with its numbers
worked out by hand in its own header so the arithmetic is asserted
independently of the code that produces it. Mutation-proved, seventeen
mutations, each one confirmed applied by a file hash before its result was
believed:

- a paraphrased takeoff sentence, and dropping the "we read fewer jobs than
  exist" note — 2 red, then 1 red;
- `laborHours ?? 0` on a wall component that carries no labor rate, and
  unnaming a run with no height — 1 red each;
- `caution: null`, `comparable ?? true`, and `Number(quote.amount ?? 0)`,
  which makes the supplier who never replied the low bid — 2, 1 and 4 red;
- a "this bid is compliant and ready to submit" verdict, and counting an
  optional item as non-responsiveness — 1 red each;
- adding the allowance that is already inside the base (277,400 where 262,400
  is right), and losing the DEDUCT word — 1 red each;
- re-sorting the recap steps, folding uncoded money into material, and
  answering for a contracted job — 1, 1 and 7 red;
- dropping the below-three-jobs refusal, flattening the range to its median,
  and not stripping the comma out of "40,000" — 1, 2 and 1 red.

Four censuses already governed the registry and all four count these tools:
`commands.test.ts`'s tool→page capability map (it failed first, naming all
seven), `eval/cases.test.ts`'s per-tool coverage, `top-questions.test.ts`
(115 → 122), and `tools.test.ts`'s derived citation/capability check, which
needed no new exception — every citation's guard equals its tool's
capability. Each was separately mutation-proved to catch a missing entry.

**One thing the census could not have caught, recorded because it is the
lesson rather than the fix.** The gap count in `top-questions.ts` did not
move: these thirteen features were never *on* the gap list. Nobody had
written the questions down, so a census built to find holes read as complete
while every one of these questions routed to nothing. A feature shipping and
a question being written are two separate events, and only the second one is
in that file.

**CI, BY SHA, AND ONE FAILURE THAT IS NOT `main`'S BASELINE.** Run
`36215728083` on `7b40038a`: `ci`, `dbtest` and `e2e-public` green; `e2e`
red on TWO tests where main is red on one.

The control was read rather than assumed. Run `36212287391` on `890100f5` —
this branch's exact base — is red on `journey.spec.ts` step 11 alone,
`62 passed`, which is the #510 baseline. Mine is that step 11 (its page list
is `/jobs/<id>/billing`, `/bids`, `/certifications`, disjoint from the three
earlier lists, exactly as the #418 entry says: the list is the race's dice,
not a location) **plus**:

    estimating-spine.spec.ts:135 › 3. wall types: the starter partition
    schedule (#467)
      Locator: getByText('Added W1 and W2.')
      Timeout: 10000ms — element(s) not found

That is the `/wall-types` starter-types button's own success sentence not
arriving within ten seconds of the click. It cascaded `8 did not run`
(`mode: "serial"`, `retries: 0`), so one write timing out cost nine verdicts.

**Why it is not this branch's — and the first version of this paragraph
claimed more than it had checked, which is this file's own worst habit, so
here is the traced version.** The diff is `lib/ask/**`, three existing test
files and one changelog file. `/wall-types/page.tsx`,
`components/WallTypes.tsx` and `lib/actions/wallTypes.ts` are untouched, and
the first draft stopped there and said they "import nothing from `lib/ask`".
That is true of those three files and MISLEADING, because `WallTypes.tsx`
imports `addStarterWallTypes` from the actions BARREL, and the barrel
`export *`s `./search` (`lib/actions/index.ts:77`) →
`lib/actions/search.ts:5` → `lib/search/query.ts:1`, which imports `TOOLS`.
So one of the two files I changed with runtime code IS in that Server
Action's bundle graph.

What that reaches, exactly. `handlers.ts` — all 859 new lines and nine new
library imports — is imported by NOTHING but `lib/ask/answer.ts`, so it
lives only in `/api/ask`'s bundle; every other mention of it in the repo is
a comment. `tools.ts` is reachable, and the change to it is 128 lines of
string literals and seven entries appended to a const array: no new imports,
no new code path, and `providerCapability` finds a tool BY NAME, so no
existing search provider's answer moves. The residual mechanism is therefore
a few kilobytes of extra string data in a shared server bundle, which cannot
change what that action returns and could at most touch a cold start.

**A SECOND SAMPLE WAS TAKEN, AND IT DID NOT REPRODUCE.** Run `36216211306`
on `3fabfe65`, the same branch one changelog commit later: `ci`, `dbtest`
and `e2e-public` green, `e2e` red on `journey.spec.ts` step 11 **alone** —
`main`'s baseline exactly. Two independent signals say so rather than one:
the verdicts block ends at step 11 with none of the eight `SKIPPED` lines
that trailed the wall-types failure in run one, and the Playwright artifact
carried **26 files against run one's 32**, which is the count `main`'s own
baseline run produced. A failed test writes its own screenshot, trace and
error-context, so that file count is a number nobody typed.

So the wall-types timeout was one bad sample, not a defect this branch
introduced — which is what two runs can support and is as far as it goes.
`retries: 0` with two workers against one Postgres makes a slow write a hard
failure, and a ten-second ceiling on a Server Action is thin: this repo has
measured post-action server render at 3.7-4.4s on a warm build (the #61
entry). **Whoever sees that test red again should suspect the ceiling before
the page**, and the cheap first read is the artifact's file count against 26.
