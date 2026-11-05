### Suggest, don't post: no wall type is priced without a person (Diego)
`diego/type-precision`

Diego's rule: a wrong type misprices a bid silently. A first version posted
only sources right 95% of the time on training. Printed tags naming a legend
code made it (95.6%), and on held-out they were right 47.6% of the time. So
**nothing posts**. Every group goes to "Walls — untyped" and the review queue
(#986). The drawing's type is pre-filled as the first, highlighted button,
with where it came from ("Suggested IW-4 · from the printed tag"), and the
estimator confirms it per group. `postingGate.ts` keeps one switch per source,
all off, each with the rate it was measured at.

| Source (7 training sheets, type keys) | Keyed ft | Correct on training |
| --- | --- | --- |
| printed tag naming a legend code | 1,022 | 95.6% (held-out 47.6%) |
| printed variant tag (A3 of family A) | 435 | 76.8% |
| tag carried along the wall | 164 | 82.0% (held-out 9.1%) |
| legend / sheet "unless noted otherwise" | 1,086 | 90.6% |
| tag read off a sibling sheet (new) | 278 | 71.9% |

Two training bugs fixed on the way:
- **Green Bay A3.1 typed nothing.** It prints no wall tags. Its "820 symbols"
  are keynote diamonds, door tags and room tags; the IW tags are on A3.2, the
  dimension plan of the same floor. A sheet with no tags of its own now reads
  them off a sibling (same sheet number up to its last point, never a
  demolition plan), aligned by the plan comparison's view alignment, marked
  " ⇄". A3.1: 0 → 200 ft correct, 78 ft wrong. Held for review (71.9%).
- **McAllen A3.2: IW-4 walls typed IW-2/IW-3** (the reverse of the report).
  Its tags are long boxes stacked edge to edge, and the reader measured every
  symbol as a circle: a box read the box above's code ("IW-5/IW-4") and took
  another tag's leader. A box at least 2.5 times as long as it is tall is now
  measured by its own outline, and a leader names only a run it lands on, not
  one whose end it stops past. McAllen 121 → 248 ft correct, 45 → 9 ft wrong.
  Baker 263 → 283 ft correct.

Suggestions, before (posted) and after these fixes:

| | before | after |
| --- | --- | --- |
| training: keyed footage with a type | 66.3% | 79.2% |
| training: of it, the right type | 88.1% | 87.8% |
| training: right type, ft | 2,147 | 2,553 |
| held-out: keyed footage with a type | 52.5% | 53.1% |
| held-out: of it, the right type | 49.5% | 49.0% |
| auto-posted | all of the above | none |

Every detected wall now waits in the review queue: 5,379 runs on the 42
training sheets (855 with a suggestion) and 2,608 on the 24 held-out
sheets (311 with a suggestion). The queue groups them, one item per
detection group.

Not fixed: Green Bay's IW-7 exterior tags end in a heavy bar drawn over the
leader's last stretch; following it gained A3.1's sibling read and cost more
on A3.2 and McAllen, so it was left out (254 ft of unkeyed IW-7 untyped).
