### A determination can carry its rates now, and that sentence was a refusal (Diego)
`diego/determination-wage-rates`

**One additive migration — one new table, three indexes, three foreign keys,
no drops.** Preflight names it and reports it additive.

**THIS REVERSES A DECISION WRITTEN INTO THE SCHEMA.** `PrevailingWageDetermination`
said of itself:

> *"Nothing here is a wage rate — there is no rate column and none is
> planned; the rate is read off the linked document by a person."*

That reasoning was sound for what it described: those columns are what the
document says ABOUT ITSELF, and a rate is not that. It is reversed
deliberately, by Diego, because it was the thing blocking multi-state rates
— and the original sentence is kept in the schema above the reversal rather
than deleted, because it explains the distinction the new model preserves.

**WHY IT BLOCKED MULTI-STATE.** Rates lived only in `FringeRateSchedule`,
which hangs off `CraftClassification` → `UnionLocal`. **A union local is not
a jurisdiction.** One craft could not hold a different rate in Nevada than
in California, and no column anywhere could express it.

`DeterminationWageRate` is a CHILD of the determination rather than columns
on it, which keeps the original distinction intact: that row is still the
document, and the rates are still what a person read off it. **Multi-state
then falls out with no jurisdiction column anywhere new** — a determination
already carries `jurisdiction`, so its rates inherit it. The same craft in
two states is two determinations with two rate sets, and nothing has to
decide which is "the" rate.

**Three deletion rules, each a different answer on purpose.** `Cascade` from
the determination (these rows are its contents). `SetNull` from our craft —
an unmapped rate is still a rate the document publishes, and deleting one of
our classifications must not delete what a government document said.
`Restrict` from Company, which blocks nothing: **no script deletes a company**,
checked rather than assumed, and `prevailingWageDetermination` is already
deleted at `clean-scratch-data.mjs:344`, before `job` at `:374`. So the
cleanup scripts need no edit — which is the conclusion #224 got wrong by not
checking.

**NO `effectiveFrom`/`effectiveTo` ON THE RATE.** The determination carries
`issuedOn`/`expiresOn` and `lib/determination-standing.ts` derives the window
from them. Dates here too would be a second source for one window, and the
two would disagree.

**The figures are copied off a PDF, which drove the parser.** Currency
furniture is stripped rather than refused — somebody pasting `$1,284.00` is
doing the normal thing, and refusing it teaches them to retype a number they
had right, which is how a digit gets dropped. And a zero BASE wage is
refused while a zero FRINGE is kept: no determination publishes a base rate
of nothing, so a 0 there is a mis-key that would price work at nothing,
while plenty of determinations carry no training contribution.

| mutation | `determination-wage-rate` |
| --- | --- |
| control | green |
| zero base wage accepted | **RED** |
| omitted fringe stored as 0 | **RED** |
| only the first fringe checked | **RED** |
| `Number()` instead of the digit guard | **RED** |

The last one is not pedantry: `Number("0x10")` is 16, and a hex-looking
paste is not a wage.

**FOUR CENSUSES CAUGHT THIS BRANCH AND EVERY ONE WAS RIGHT.**

- `exportCompletenessCensus` — a new model must be in exactly one export
  bucket. It is withheld, for that bucket's own stated reason: *"Hours are
  exported; what they are worth is not."* Exporting a determination's rates
  would hand over precisely what the bucket exists to hold back.
- `formActionCensus` — a client `<form action={…}>` **resets before the
  action runs in React 19**, so the refusal "a base wage of 0 is not a rate"
  would have arrived over emptied fields, after somebody had copied six
  figures off a PDF. It is `onSubmit` + `preventDefault` now, resetting only
  on success.
- `theme-contrast` — the save button carried `text-brand-ink` on `bg-brand`.
  White on the founder yellow is 1.53:1; `text-neutral-900` is 11.71:1.
- `commands.coverage` — every exported action is a command or excluded with
  a reason. Both are excluded: a card would put a model between somebody and
  a PDF they are reading digit by digit, which is the one place a plausible
  number is worse than no number.

**Not clicked.** 547 files / 8595 tests green, typecheck, lint and preflight
clean. Nobody has opened a job's compliance tab and typed a rate in.
