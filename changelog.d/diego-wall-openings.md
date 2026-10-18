### A doorway is not the end of the wall (Diego)

`diego/wall-openings`

**Measured first.** School-01 A-101, five exam rooms counted off the drawing by
hand against the detector's output:

| | |
| --- | --- |
| real wall in the region | **233 ft across 9 walls** |
| feet the finder put a line on | **197 ft** |
| recall by footage | **84%** |
| false positives | **zero** |

And the gap list named its own cause. Corridor wall 85% — *"gaps are mostly the
five door openings"*. Back wall 71% — *"gaps at the three office doors"*. Grid B
61% — *"the stretch near the column"*. The five acoustic walls between the
rooms, which have neither openings nor columns, came back **92–100%**.

**It was not missing walls. It was stopping at every hole in one.**

#### And stopping there underbids, which is the part that makes this a money fix

`takeoff.ts` deducts no opening under **32 sq ft**, and says why:

> *a door or a window still costs labour to cut and finish around, and deducting
> it underbids the work*

A 3'-0" × 7'-0" door is **21 sq ft** — under the threshold, not deducted. The
studs and track run through it as a header and cripples. **So the gross length
is the correct take-off across a door**, and reporting two fragments either side
of it is exactly the underbid that threshold exists to prevent.

So `mergeWalls` now joins collinear runs across a gap up to **8 ft** — a single
door, a double door, a wide cased opening — and records each gap as an opening
with its measured **width**.

**Width and not height**: a floor plan does not carry one, and inventing a height
to deduct with would be a guess that reaches a bid. The openings are reported,
not deducted, and the panel says so: *"includes 3 openings, not deducted"* — a
bigger number with no explanation beside it is the next unexplained figure.

#### This reverses a decision the file stated outright, and half of it was right

`mergeWalls` carried: *"Without this, two walls far apart on one line — either
side of a doorway, say — would merge into a single run straight through the
opening."*

Right about large gaps, wrong about doors. **Past 8 ft a gap is not an opening,
it is where the wall stops** — a corridor crossing, another room — and joining
across it invents wall nobody can build, in the direction that overbids. That
bound is kept and tested.

**And the test guarding that decision was right about a second thing, which only
showed up by running it.** It also pinned that two runs on *slightly different*
lines must not be grouped and rebuilt on one — *"two runs of the right length in
the wrong places, which no total catches"*. Two OVERLAPPING findings of one wall
legitimately sit a third of a foot apart; two runs with a GAP making that claim
is weaker, because if they are one wall either side of a door their faces are the
same lines. So a gap-join needs **four times tighter** collinearity than an
overlap-merge, and that original test passes unchanged.

#### Checks

469 tests in `lib/takeoff`. **Ten mutations, nine red** — no joining at all (the
underbid as measured), any gap joining, the bound in page units, the collinearity
guard removed, openings joined but unrecorded, a width in page units, only the
first opening recorded, an empty array on every run, the spans loop undoing the
union-find, and the panel no longer saying the footage is gross.

**Two were green first and both were my tests being too weak.** The scale case
passed whether the bound was divided by the scale or not, because at half a foot
per unit both forms answer "join" — it needed a gap that is *small in page units
and large in feet* (4 ft/unit, 3 units apart, 12 ft of building). And the panel's
sentence had no census at all.

The tenth is **equivalent and the code now says so**: there are two gates on the
gap, and the spans loop is the binding one, so the union-find's copy can only
reduce work. It is kept as a pre-filter because grouping is not free of
consequence — a group is rebuilt on its leader's line.

#### What this does not do

It does not fix a **scanned or hatched** sheet. The measurement above is a clean
export, which is the easy case, and Augusta behaved worse. One region, one sheet:
a floor, not a forecast.

No schema change. Preflight green.
