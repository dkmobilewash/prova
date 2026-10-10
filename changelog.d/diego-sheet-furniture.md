### The title block is found by what it IS, not by guessing where it is (Diego)

`diego/sheet-furniture`

#722 fixed the drawing frame by geometry and said plainly that the title-block
cells were still coming back as 4-3/8" walls — they are short runs *inside* the
border, and every cheap way to guess that corner also drops real wall, because a
plan is routinely drawn right up to the title-block strip.

**So stop guessing where furniture is and ask what furniture IS.** The frame, the
title block and the logo are the only geometry at the **same page position on
every sheet of a set**. A wall is not.

`sheetTemplate.ts` samples other pages of the open document, keeps the stroke
positions that recur, and removes them from this sheet before detection runs.

#### The hazard this is designed around, and it is not hypothetical

**Levels 3 to 10 of a tower are the same plan at the same page position**, so
their *real walls* recur. A rule that dropped anything appearing twice would
delete the walls of exactly the repetitive buildings this tool is most useful
on — silently, which is the failure mode this whole directory is organised
against.

Furniture is on 100% of sheets. So the samples are **spread across the whole
document** rather than taken from neighbours, and a position has to appear on
most of them. Eight identical floor plans inside a fifty-five-sheet set cannot
carry four of six evenly spread samples; a border can and does. Evenly spaced
samples also cross disciplines — architectural, structural, mechanical — where
nothing but the template survives.

There is a test for a set that is **nothing but identical floors**, and it
asserts that this does drop their walls. That case has no signal distinguishing
walls from frame and this module cannot invent one; six identical sheets is not
a set, it is one sheet printed six times.

#### It fails safe, and the direction is deliberate

Fewer than three sheets read, a page that will not parse, a sample that came
back empty — all mean "cannot tell", and nothing is filtered. The cost of not
filtering is a border in the panel, which #722 catches geometrically and a
person can see. **The cost of the other default is a wall quietly missing from a
bid.**

#### What it says on screen

> *N lines on this sheet also appear in the same place on the rest of the set —
> the border, the title block and the logo — so they were left out.*

A filter that quietly returns a smaller number is how the next unexplained
figure gets created. If that count is large and the panel is empty, the filter
is the first thing to suspect rather than the sheet.

#### The limitation, pinned rather than hidden

Positions are matched on a grid, and **grid rounding cannot tolerate drift in
general**: 0.5 lands in one cell and 0.500375 in the next. One template rendered
on many pages emits identical coordinates, which is the real case and matches
exactly — but a set whose pages differ slightly in MediaBox could straddle a
boundary, the template would come back short, and the filter would stop dropping
things. Fail-safe again, and a test says so.

**If a real set ever shows its title block surviving, that is the first thing to
check**, and the fix is neighbourhood matching with a measurement to justify it.

#### Checks

22 cases, **ten mutations all red** — the template never found, a two-sheet
threshold that eats identical floors, the fail-safe inverted, empty sheets
counted, duplicates on one sheet counted, the key not canonically ordered,
samples taken from the front instead of spread, `withoutTemplate` returning
everything, and two at the call site: the detector handed the *unfiltered*
strokes, and the dropped count reported as zero.

**Two mutations were green first and both were my tests being too loose.** The
duplicate-counting one was equivalent at this threshold — two copies against a
threshold of three changes nothing — so the case was rewritten with enough
copies to *reach* the threshold, which is the shape that actually bites
(hatching in a repeated block templating its own sheet). And the census only
checked that `setTemplateStrokes(` appeared, which `setTemplateStrokes(0)`
satisfies while reporting nothing.

**The call-site check is a census and says so in its own header.** It can see
the sampler is called, that the filter runs BEFORE the detector, and that the
filtered set is what the detector receives. It cannot see that sampling works on
a real set — that needs pdf.js, a real document and a canvas, which is why this
ends with somebody pressing the button on Augusta.

No schema change. Preflight green.
