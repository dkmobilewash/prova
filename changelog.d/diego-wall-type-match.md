### A detected wall group the drawing named now goes onto the estimate priced (Diego)

`diego/wall-type-match`

**The last link in the takeoff chain, and everything either side of it already
existed.** The finder returns groups by thickness; `wallTags.ts` already reads
the drawing's own labels and knows which runs carry which. So the app has been
showing *"this 4⅞″ group is tagged W1"* on screen while the estimator picked the
wall type by hand — for every group, on every sheet.

Press **Add as W1 — priced** and the group becomes a real `WallRun` against the
company's W1, with line items carrying unit price, budgeted cost, craft, catalog
link, production rate and cost category. Everything downstream — the recap, the
proposal, the schedule of values — already works on those.

#### Why the tag and not the thickness

The obvious design is to match detected thickness against the wall type's
thickness. **It is not available and should not be invented**: `WallType` has
`code`, `name`, `defaultHeightFt`, `sides` and `studSpacingIn` — no thickness —
and deriving one from its components means parsing "⅝″ Type X" out of a
description, which is a guess wearing a measurement's clothes. Two types also
routinely share a thickness and differ in rating and layers, so thickness cannot
identify a type even in principle.

**The drawing already says which wall is which, and `WallType.code` is the same
designation the drafter printed.** So this is an identity match, not a similarity
score — which is the only reason it can be trusted enough to price from.

#### It refuses more than it matches

Every outcome short of one unambiguous tag naming one of the company's own types
is a refusal that says what is missing, because the estimator acts on each
differently:

| | |
| --- | --- |
| **NO_TAG** | the drawing named nothing here. No sentence at all — a notice on every untagged group is the noise that teaches people to stop reading notices. |
| **NO_SUCH_TYPE** | *"The drawing tags these W9, and you have no wall type W9 with layers."* The actionable one — and the sheet's own partition schedule usually says what W9 is, which `SCHEDULE_ROWS` has already read. |
| **MIXED** | more than one name with no clear majority. The group spans two types that share a thickness, and pricing it as either prices part of it wrong. |

`TAG_MAJORITY` is 0.85 and the tests are what make it a decision rather than a
number: a 60/40 group refuses, a 95/5 group matches, **and the 5% is named on
screen** — it is priced as the majority, which is a real cost and belongs in
front of somebody rather than in the recap.

Normalisation goes exactly as far as punctuation: "W-1", "W 1" and "w1" are one
designation, and **"W1" does not match "W11"**, which is a different wall at a
different price.

#### What it deliberately does not do

**There is no "accept all".** Each group is accepted with that group drawn on the
sheet in front of the estimator — the same posture as the scale prefill and the
sheet index, and the same reason: the border and title-block work (#722, #723)
reduced the contamination in detection without eliminating it, and hatching is
still counted. The convenience stops short of the thing that would hurt a bid.

#### Checks

- 21 unit cases plus 15 against a real Postgres. **Fourteen mutations, thirteen
  red** — a bare majority accepted, MIXED never firing, normalisation that makes
  W1 match W11, an empty designation matching everything, the leader taken as
  the first entry rather than the largest, NO_SUCH_TYPE no longer naming the
  tag, the sentence no longer naming the type, the minority going unsaid, an
  untagged group getting a notice, the `wallTypeId` ignored, the measurements
  discarded on refusal, the calibration doubled, and the viewer not sending the
  match.
- **Three were green first and two were real holes.** Nothing asserted the
  priced QUANTITY — doubling the calibration left every assertion green with the
  footage twice the building, which is the only failure this feature could
  actually cause, so it is now asserted in feet of real geometry (20 ft × 9 ft ×
  2 sides = 360 SF). And the viewer's one line setting `wallTypeId` could be
  deleted with all fifteen database cases still green, because they call the
  action directly — that is now a census, which says in its own header that it
  proves the code is present and never that it is honoured.
- The third green is **genuinely equivalent** and the code says so: a `feet > 0`
  filter that the total guard below already covers, kept because it states the
  intent where the filter is read.

#### Two things found on the way

**The dbtest fixture had no `User` row**, so `createdByUserId: ""` was a foreign
key violation — and it surfaces as a bare `PrismaClientKnownRequestError` with
an **empty message**, which reads like a broken query rather than a missing row.
The suite had run for months without one because every earlier case creates
measurements directly in the fixture, so nothing had ever taken the path that
stamps an author.

**`clusterTag.test.tsx`'s census needed updating, not weakening.** It pinned
`setTagNames(namesForClusters(` and both the names and the match now come from
ONE pass (`taggedFeetForClusters`), because two walks of the same runs would be
the second list CLAUDE.md warns about. The intent it guards is unchanged.

#### And today's earlier work is what makes this safe to ship

A wrongly auto-priced group has to be removable. **#719** made deleting the wall
run clear `postedAt` so the measurement can be priced again, and **#716** made a
deleted line stay deleted. Without those two, a bad match would have been a dead
end.

No schema change. Preflight green.
