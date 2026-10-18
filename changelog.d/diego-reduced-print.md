### A half-size print was measured at half scale, silently (Diego)
`diego/reduced-print`

A reduced print carries the **full-size scale name** in its title block, because
the title block was drawn long before anyone chose what paper to issue it on. So
the name says `1/8" = 1'-0"` and the paper is physically 1/16" = 1'-0".

Taking that name at face value measures every length at half. Not a rounding
error — half the job.

#### The page that proves it

On the 60-page answer key, three pages are half-size prints of an ARCH D
original. They divide exactly along whether the DIMENSION path happened to work:

| page | width | labels | dimensions say | the app used | key score |
| --- | --- | --- | --- | --- | --- |
| 11 | 18in | 20 | 16.00 ft/in | 16.00, measured | 66% |
| 17 | 18in | 32 | 16.00 ft/in | 16.00, measured | 66% |
| **50** | **18in** | **0** | **declined** | **8.00, from the NAME** | **32%** |

p50 was measured at HALF its real scale, its own sister pages prove what that
scale is, and it scored worst of all sixty pages in the key.

#### Two detectors that do not work, both measured

**Sheet size cannot see it.** `scaleFromPrinted` already requires a standard
sheet size, and **a half-size ARCH D is exactly an ARCH B** — 1296 x 864 points,
a size drawings are genuinely issued at. No property of one page separates the
two.

**An absolute lettering threshold cannot either.** Across 548 real drawing pages
the modal body lettering on 36in sheets runs 4.50pt to 40.25pt, and the key's own
FULL-SIZE pages sit at 4.50 — *below* the half-size pages of other sets. Any
fixed floor flags real full-size sheets.

#### And one that fails dangerously, which is the more useful finding

The first implementation checked the printed name against raw `scaleCandidates`.
The corpus caught it: on Naples p9 it "corrected" 8.00 ft/in to **32.00** on 38
backing candidates, while that page's own dimension vote independently said
8.00. A 4× error — far worse than the bug being fixed.

`scaleCandidates` emits every plausible label-to-segment pairing, so spurious
clean multiples are abundant. **They are hypotheses for a vote to weigh, never
evidence to count.** That module is deleted and its header records the trap so
nobody rebuilds it that way.

#### What works: the SET is its own control

A reduction is done to a whole sheet, so the page comes out a clean fraction of
the size the office issues at. Two independent measurements of that both score
perfectly over nine sets and 548 pages:

| rule | caught | false positives |
| --- | --- | --- |
| page width vs the set's modal width | **3 of 3** | **0 of 513** |
| title-block lettering vs the set's template | 3 of 3 | 0 of 513 |

The **width** is used, because `PlanSheetText.widthPt` has been stored per page
since the inventory stage was written — no migration, no new extraction. The
lettering is the stronger evidence in principle, since it proves the template
itself was scaled, and the module says so: it is what to reach for if a false
positive ever appears.

#### Where it is allowed to act

Only on a sheet whose **dimension vote has already declined**. A dimension is
measured off the drawing and cannot be fooled by a reduction — reduce the sheet
and both the line and its stated length come down together. So a measured scale
is never touched; this only improves a reading taken from a title block with
nothing checking it.

Three conditions must all hold before a number changes: a clean whole fraction
of the set's size, a set with a modal size to compare against, and **the
corrected value must itself be a standard architectural scale**. A reduction
landing between scales offers nothing rather than rounding.

#### The case it cannot tell apart, stated plainly

A set that is mostly ARCH D with a **genuine** ARCH B sheet in it looks identical
to a half-size print. No page in the corpus is that, so the rule is unmeasured
there rather than proven safe. What keeps it survivable: it only runs where
nothing else could check, the result must be a real scale, and **the screen says
it corrected and why** — so an estimator on a genuinely small sheet can see the
claim and disagree with it.

#### Checks

- **Eight mutations, every one red**: reductions never detected; the ratio
  inverted; the set size taken as the maximum instead of the mode; a correction
  off the scale list accepted; a MEASURED scale corrected too; the name
  corrected but not the distance; the caution rendered on no screen; the caution
  stripped of its warning colour.
- A **render** test, not a census — #665 is why. It renders `ScaleOffer`
  directly and says why: the panel lives in the draft branch, which needs a line
  drawn on a pdf.js canvas that never renders in happy-dom. Measured rather than
  assumed — a probe pressed Set scale, then the port, then the SVG, and the
  sheet read "Drawing…" throughout.
- 20 unit tests on the detector, 39 on the view seam, 6 on the screen.
- Preflight green. No migrations.

#### Click-list

1. Open a set that contains a half-size sheet and go to that sheet.
2. Press **Set scale** and click the two ends of any line.
3. The panel must show an amber caution saying the sheet is a half-size print,
   naming both widths — and the scale above it must be the **corrected** one,
   introduced as "Corrected for the reduction".
4. On any ordinary sheet of the same set, the caution must be **absent** and the
   wording must read "The title block on this sheet says…".
5. On a sheet whose scale came from dimensions, the caution must be absent and
   the matched dimensions listed instead.
