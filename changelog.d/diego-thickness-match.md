### A thickness group is not one wall type, so it stops being shown as one (Diego)

`diego/thickness-match`

School-01's biggest group read:

> **4-7/8"** · A1 / A2 / EXT-1 / C1 · 41 runs · **1,117 ft**
> *"names more than one type in this group, so it cannot be priced as one"*

**58% of the sheet's footage**, stopping at plain measurements. The refusal was
correct — pricing that as A1 prices the A2, EXT-1 and C1 runs wrongly. **The
group was what needed fixing.**

#### Tag first, then thickness, then ask

`wallGroups.ts` splits each thickness bucket into one group per tag the drawing
printed, plus whatever carries no tag. Then:

| the group | how it is identified |
| --- | --- |
| carries a tag | **by name.** The drafter wrote `A1` beside that wall |
| no tag, one type that thick | **by thickness** — and the sentence says the drawing named nothing |
| no tag, two types that thick | **it asks.** One question for the group |
| no tag, nothing that thick | plain measurements, as before |

That ordering is the whole safety argument. **Thickness never overrules a tag
and never guesses between two types** — it speaks only where the drawing was
silent and the answer is unique.

The same sheet shows why the question has to exist: **A1 and A2 are both 4-7/8"
there**, differing by fire rating, which a floor plan cannot show.

#### What #731 made possible

An architect tags *representative* walls, not every wall — 25–43% of the
footage on a real sheet. So splitting by tag alone leaves the majority of every
drawing unpriced. The partition schedule is what gives the remainder a
thickness to be looked up by, which is why it had to land first.

On the School-01 group: **420 ft priced where 0 ft was**, 90 ft naming what is
missing (`EXT-1`, which the library has no type for), and 607 ft asking **one
question** instead of being abandoned.

#### A paragraph in `wallTypeMatch.ts` that was true when written

Its header argued against matching by thickness: *"It is not available and
should not be invented… deriving one from its components means parsing '⅝″ Type
X' out of a description, which is a guess wearing a measurement's clothes."*

Accurate until #731. **The other half of that paragraph survives and is the
load-bearing half** — *"two types routinely share a thickness and differ in
rating and layers, so thickness cannot identify a type even in principle"* — and
it is why thickness is a shortlist here and never an identity.

#### Checks

Preflight green, 10,001 tests, no migration. **Ten mutations, ten red** — two
only after the tests were fixed:

- **the slack test could not fail.** It probed at `THICKNESS_SLACK_IN + 0.01`,
  which moves *with* the constant it tests, so widening the slack widened the
  probe. The bound is a literal now, and the case states the consequence: a
  library holding a 4-7/8" and a 5-3/8" type would see one measured group match
  both, turning an answer into a question.
- **the button could promise a price the submit never sent.** Both read
  `pricedTypeFor`, but `toContain` cannot tell two identical call sites apart —
  replacing the panel's copy left the census green. It counts both now.

Three parallel arrays indexed against the group list became one: a `WallGroup`
carries its own tag and its own candidates, so they can no longer fall out of
step.
