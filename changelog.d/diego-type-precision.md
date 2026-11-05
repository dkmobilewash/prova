### Precision first on wall types: a type posts only from a source right 95% of the time (Diego)
`diego/type-precision`

Diego's rule: a wrong type misprices a bid silently, so the whole-set run posts
a type automatically only from a source that is 95% right on the training
keys. Everything else goes to "Walls — untyped" and the review queue (#986),
with the type the drawing gave offered first as a highlighted button.
`postingGate.ts` holds the table, each line with the rate it was set from, and
the eval scores through the same function.

| Source (7 training sheets, type keys) | Keyed ft | Correct | Posts |
| --- | --- | --- | --- |
| printed tag naming a legend code | 1,022 | 95.6% | yes |
| printed variant tag (A3 of family A) | 435 | 76.8% | no |
| tag carried along the wall | 164 | 82.0% | no |
| legend / sheet "unless noted otherwise" | 1,086 | 90.6% | no |
| tag read off a sibling sheet (new) | 278 | 71.9% | no |

Printed tags are 100% on five of the six sheets that have them; Joplin's
plain-code tags (65%) are the misses.

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

Results (correct of what is POSTED):

| | before | after |
| --- | --- | --- |
| training typed | 66.3% | 27.6% |
| training correct-of-posted | 88.1% | 95.6% |
| training walls to review (42 sheets) | 4,565 of 5,379 | 5,132 of 5,379 |
| held-out typed | 52.5% | 12.2% |
| held-out correct-of-posted | 49.5% | **47.6%** |
| held-out walls to review (24 sheets) | 2,289 of 2,608 | 2,465 of 2,608 |

**Held-out does not hold.** Legend-code tags are 47.6% right there, so the
95% bar set on training does not carry over. Measured once, not tuned.

Not fixed: Green Bay's IW-7 exterior tags end in a heavy bar drawn over the
leader's last stretch; following it gained A3.1's sibling read and cost more
on A3.2 and McAllen, so it was left out (254 ft of unkeyed IW-7 untyped).
