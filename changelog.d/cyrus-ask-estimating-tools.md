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
