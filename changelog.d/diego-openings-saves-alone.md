### The openings setting could not be saved, and three green checks said it could

Shipped yesterday as a fourth question inside the business-scope form. The three
onboarding radios there are `required`, so the **browser** refused to submit
until all three were answered — and the openings answer went down with them. For
any company that had skipped onboarding, which is every company that has not
answered those three, the setting was on screen, selectable, and **dead**. Not a
permission error and not a message of ours: a native tooltip on a different
question.

Found by somebody clicking Save. It now has its own form
(`OpeningDeductionForm.tsx`), its own action (`saveOpeningDeduction`), and
nothing else on either, so no other field's validation can take it down.

**What the tests said at the time, all three correct and all three useless here:**

| check | said | could not see |
| --- | --- | --- |
| `openingDeduction.test.ts` census | the question renders on Settings | that Save never fires |
| the same file's unit test | it is not in the required list | that a SIBLING field's `required` blocks the form |
| `companySetupGate.test.ts` | the welcome screen still has 3 controls | — (this one did its job) |

A census reads source; `required` does its work in the browser. So the
replacement assertion is a property source can actually be read for: **the
openings form carries no `required` input at all**, plus its action writes only
its own column, plus the render site opens its own line (a substring search
passes on `{null && <OpeningDeductionForm …}`, which renders nothing — the #665
shape, and the one mutation that got past the first version of this fix).

Two smaller things from the same click-through: the options are **vertical** now
(three long labels inline ran together, and `contractingRelationship` — the
other three-option question — already stacks), and **"Not set"** is a real
option rather than an omission, so a shop that picks a convention can get back
to the default. The click-through could not test clearing for exactly that
reason.

### And the step that could not be run at all

The click-list's only step that touches money — change the setting, re-save a
wall run, watch the drywall area move — was unrunnable: **there is no wall run
anywhere on the live account.** Twenty jobs, fourteen with an empty wall schedule
and six with none. So the single claim the feature rests on had never been
executed by anything.

`lib/estimating/opening-deduction.dbtest.ts` now does it against a real Postgres
in CI: a 20ft × 10ft wall boarded both sides with a 3'-0" × 7'-0" door, through
`syncWallScheduleLines` to the `JobLineItem` quantity. Unanswered bills 400 sq ft
gross; `ALL` takes 21 off **each face** (the per-side half is its own assertion —
a hole goes through the wall); `NONE` and `LARGE_ONLY` agree on a door and are
separated by an 80 sq ft storefront, so neither can be a dead option with every
test green; and changing the answer **re-quantifies the existing line** rather
than adding a second, which would double-count board with every quantity
assertion still passing.

Grown as a fixture rather than typed into production, per the rule from the
payroll export: a fixture is checked on every CI run, a row somebody typed into
production is checked once.

Three existing censuses caught real defects in the new component on the way:
`colorTokenCensus` (`text-ink-on-brand` is not a token this app defines, so the
label would have rendered colourless on the yellow), `theme-contrast` (same
line), and Ask's `commands.coverage` (every exported action must be registered or
excluded — this one is excluded, because a setting that silently moves the
quantity on every future bid is the last thing a model should flip from a
sentence).
