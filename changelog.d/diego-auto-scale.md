### The drawing already knew its own scale (Diego)
`diego/auto-scale`

Setting the scale on a sheet was four steps: find a printed dimension, click
each end of it, read it, type it. Until that was done `TakeoffPlanViewer`
disabled Line, Area and Count — *"Set the scale on this sheet first."*

The architect had already written the answer on the sheet. A real ARCH E1 export
(42×30, 1/8" = 1'-0") carries **30 printed dimension strings**; pairing each with
the line it annotates and voting over the standard scales derives
**`1/8" = 1'-0"` with 0.000% error** on the scale and **0.315%** on the line
proposed to store it. So the estimator now sees the scale filled in with its
evidence and presses the button they pressed before.

**WHY THIS IS NOT THE THING #623 DECLINED, because the distinction is the whole
licence to build it.** That PR's record says the printed scale *"implies a factor
and not a dimension"*, and that a calibration *"is the line somebody drew… so
the printed scale cannot become one without inventing a second calibration
mechanism with different evidence behind it."* Both still true, and both about
the scale NAME in the title block — which yields a factor and needs
`pageWidthPt`, a column whose own comment calls it "A LABEL INPUT AND NOTHING
ELSE". A printed DIMENSION is a line and a distance, which is exactly what
`TakeoffScaleCalibration` already stores and exactly what a person supplies. So
`TakeoffScaleCalibration` is **unchanged**, nothing stores a factor, and the new
table holds the same two facts found rather than typed.

**Why it can be accurate, and the correction I owed my own analysis.** Scales are
a short list, not a continuum, so the output is a vote over a fixed set and a
modest error lands on the same answer. The tightest neighbouring pair of the
twelve ARCHITECTURAL scales is 1.333× apart — a **15.5%** error to pick the wrong
one. But `STANDARD_SCALES` holds nineteen, and across all of them the tightest
gap collapses to **3.3%** (`1" = 10'` against `3/32" = 1'-0"`), where a 4% error
would pick wrong confidently. The vote therefore runs over the twelve, which is a
statement about this product: specialty trades take off architectural sheets, and
nobody takes drywall off a site plan at 1" = 50'.

**The span floor, and the measurement that justified giving the automatic path
its own.** `MIN_CALIBRATION_SPAN` refuses a human's line under a twentieth of the
page because *"the error in a scale is the error in the two clicks divided by the
length between them"* — a two-pixel slip, ±3% at that floor. Every printed
dimension on the real sheet fails it, the longest by **0.2 of a point** (151.0
against 151.2). The floor is right and is untouched for human calibration; it
does not transfer, because an automatic pair has no slip at all. It is held
instead to the error it actually carries, which is knowable without knowing the
answer: once the vote names a scale, the stored pair's own deviation from that
scale is what every later measurement inherits. Capped at 0.5%; measured at
0.315%, a tenth of what the human floor permits.

**AND THE FIRST VERSION OF THAT BAND REPORTED THE WRONG NUMBER.** It derived a
theoretical bound from how precisely the figure was printed — `16' - 4 1/2"` is
written to the half inch, so ±1/4" on 16.375 ft is 0.127% — and showed that. The
real deviation was 0.315%, nearly three times worse. An error band that
understates itself is worse than none, because it is the number somebody relies
on. Measured beats derived.

## Four things the real sheet found that no synthetic one could

**1. A live parser bug, and it was never about this feature.** `parseFeetInches`
ran `.replace(/^-/, "")` BEFORE `.trim()`, so `24' - 6"` — how a drawing prints a
dimension, and therefore how somebody copying one types it — kept its hyphen and
came back *"can't be negative"*. `24'-6"` worked, and so did any dimension whose
inches were ZERO, which is why it hid: `11' - 0"` parses, `11' - 3"` does not.
Three of the sheet's 30 dimensions parsed and all three ended `- 0"`. That field
is the one an estimator types into; its placeholder is `24'-6"` without spaces.

**2. pdfjs DETACHES the buffer it is handed.** `openPlanPdf` passes a VIEW of the
caller's Buffer, deliberately, so a 250MB set is not copied — and pdfjs then
detaches it, so `openPlanPdf(bytes)` consumes `bytes` and anything reading from
it afterwards throws `Cannot perform Construct on a detached or out-of-bounds
ArrayBuffer`. Latent until the first stage wanting both text and geometry hit it
immediately. The memory reasoning stands; `PlanPdf.pageStrokes` now serves both
layers from one document, which also halves the parse.

**3. The pairing rule was backwards, and only a real drawing could show it.** It
allowed a segment a radius proportional to ITS OWN length, so every long wall
face passing near a label collected a vote — and a line four times too long
explains the same figure at a scale four times finer. 30 labels produced **5,698**
candidate pairings and the vote split between 1/8" and 1/2": a decline, from
evidence that was mostly noise. The real relationship is tight — a dimension
string sits CENTRED on the line it measures, just off to one side — and stating it
as geometry cut the pairings to 419 and the answer to exact.

**4. My first scan found 13 of 32 dimensions**, missing every fractional one —
`15' - 3 7/16"`, `16' - 9 3/8"` — which are the longest on the sheet and so the
most useful.

## Checks

Fourteen mutations, thirteen red and each naming its offender: one agreeing
dimension accepted; the runner-up margin dropped; the engineering scales admitted
to the vote; the error cap removed; the centring test removed; the perpendicular
test removed; longest-accurate reverted to first-wins; the title block no longer
excluded; the hyphen strip put back before the trim; the scale write skipped on a
decline; a geometry throw taking the page down; a half-written row offered as a
prefill; a declined row offered as one.

**The fourteenth stayed GREEN and that is a finding rather than a gap.**
Replacing the dimension pattern with a bare `/\d{1,3}'/` changes nothing,
because every string that then slips through — `3'-0" x 7'-0"` from a door
schedule, `8' - 0" A.F.F.` — is rejected one line later by `parseFeetInches`. So
the anchoring is defence in depth and the PARSER is the load-bearing guard.
Recorded in the file, because loosening the parser is what would actually let
notes into the vote and no test here would catch it.

**And one of my own tests was wrong, which is why it is worth writing them to
fail.** I asserted that a bare `-6` is refused. It parses to -6: the plain
decimal path has no opinion about sign, unchanged by the hyphen fix, and callers
needing a floor pass one. The test now says what is true.

Two censuses caught omissions in this work before CI could: `colorTokenCensus`
(three invented colour tokens, and three more that are grandfathered-undefined
with a site-count ratchet I would have pushed up) and `exportCompletenessCensus`
(the new model classified in no bucket).

Four gates green: **9,164 unit tests, 678 db tests** on a throwaway Postgres,
typecheck, lint.

## The bound, and it is why the estimator presses Accept

**One real sheet is one sample.** The synthetic arms prove the arithmetic across
all twelve scales and every refusal path; the real export proves it survives one
real CAD file. That is why this is a prefill the estimator agrees to rather than
a scale the app applies — a wrong scale multiplies through every wall and the
whole bid. More real sheets, from other CAD programs, come before that changes.

Nothing from the drawing used for this measurement is in the repo, as a fixture
or otherwise. It is a real project drawing.
