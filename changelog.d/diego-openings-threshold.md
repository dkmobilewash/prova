### "Only the big ones" secretly meant 32 sq ft, and the shop couldn't say otherwise

A practising estimator's account of the trade, on how drywall takeoffs handle
openings: *estimators usually deduct for large openings but often ignore small
or medium ones*, with a threshold rule of **"32 or 50 square feet"**.

The first half confirmed what shipped — the 32 sq ft default an unanswered
company gets is a real industry figure, and nothing about it needed changing.
The second half did not: **a shop on 50 had no way to say so.** The option read
"only the big ones, like a storefront" and meant a number nobody could see or
change.

It is now editable — `Company.openingDeductionSqFt`, consulted only for
`LARGE_ONLY`, blank meaning "use our 32". Stored whatever the answer is, so a
shop that switches to "bid solid" and back does not lose its figure.

**Deliberately not read for an unanswered company.** The number belongs to that
one answer; a figure left behind by a previous answer must not move a company
that has since cleared it, because unanswered has to be quantified exactly as it
was before any of this existed.

### A true sentence that expired when a setting gained a parameter

The fourth option read *"the same as 'only the big ones'"* — correct when it was
written, and the fix for an earlier wording that implied they differed. It
stopped being true the moment that option got its own number: a shop on 50 is
not our 32, so the claim became false for exactly the companies most likely to
read it. The label names **our** default now, which is accurate whatever they
type, and the test pins the inequality rather than deleting the case — this one
sentence has now been wrong in two different directions.

### Three existing censuses caught real defects, and two were money bugs

- **`numericInputCensus`** forbids `type="number"` anywhere, from a real Chromium
  measurement: a value the browser dislikes submits an **empty string**, and a
  typed thousands comma is dropped before the server sees it. On a nullable
  field that is the worst case — the figure silently becomes blank, blank means
  "use our default", and a shop that typed 50 would be quantified at 32 with
  nothing on screen to say so. Now `type="text"` with `inputMode`, and the
  action parses through `lib/numeric-input.ts` like every other number in the
  app, so `2,800` is accepted rather than becoming `NaN`.
- **`colorTokenCensus`** refuses to let a *known-undefined* token grow: it
  tolerates `surface-input`'s 39 existing sites and caught this as the 40th.
  Tailwind emits nothing for an undefined class, so the field would have had no
  background at all.
- **`type` narrowing**: `businessScopeLine` and `hasNoScopeAnswers` asked for the
  whole `BusinessScopeAnswers` while reading only the three onboarding answers,
  so a raw `Company` row stopped satisfying them the moment this column arrived
  as a Prisma `Decimal`. They take a `Pick` now — a function should ask for what
  it uses.

### Verified

Seven mutations, each red: the shop's threshold ignored; a zero read as a
threshold instead of refused (which would silently duplicate the `ALL` answer);
the figure leaking into the unanswered case; the `Decimal` not converted to a
number; the field losing its name; the action not saving it; the label claiming
the old equivalence.

The db test gained the case the pure test cannot reach — the figure is a
`DECIMAL(6,2)`, so it arrives as a Prisma `Decimal` and the resolver compares it
with `> 0`. A 42 sq ft opening is deducted at our 32 and **survives** at a
shop's 50, chosen so the two thresholds disagree on one opening: a size both
agreed on would have passed whether the number reached the quantity or not.
