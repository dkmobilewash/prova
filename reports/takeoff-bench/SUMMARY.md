# Can C-Stream take off walls? A plain-English answer

*For Diego. Written from `SCORECARD.md`: 60 test cases plus 20 holdout plans, run against `main` at #681 ("Find the walls finds about twice as many of them"). Every number below came from the app's own code running on PDFs we generated, not from guessing at what the code does.*

## The short version

**No. It is not ready to offer as a free public wall-takeoff tool.** On a clean, well-drawn commercial floor plan it finds about **two thirds of the wall footage**: most interior partitions, almost no exterior walls. Nothing on screen tells the estimator what it missed. On some common export types it finds **nothing**. On two kinds of sheet it can set the **scale wrong by 2x** and present that as an answer.

What works: scale-reading is accurate whenever it answers on a normal full-size plan. The materials arithmetic (studs, track, board, insulation from a wall run) is **exactly right**: it matched an independent hand calculation to the unit. The weak part is *finding the walls*. It improved a lot in #681 (Level 1 went from 51% to 65% of the footage), but not enough.

## What we tested

We invented a building: Mesa Ridge Medical Office, two stories, about 38,800 SF, steel frame, metal-stud interiors, EIFS and stucco outside, Phoenix. We drew a full bid set from one master model: cover, both floor plans, ceiling plan, elevations, enlarged plans, partition types, door and window schedules, structural, mechanical, and an addendum.

We then exported it 16 different ways that real CAD programs export:
- Revit-style and AutoCAD-style
- rotated pages and half-size prints
- text saved as outlines
- hidden layers
- a scan
- through a second PDF engine (Chromium)

Because we drew every wall, we know the right answer to the inch. Every miss and every phantom is counted exactly.

We also generated **20 random floor plans** that none of the code was tuned on (the "holdout"). Fixes may be tuned on Mesa Ridge, but must then be checked on those 20.

## What it gets right

- **Scale on a normal full-size plan.** It names the right scale on every full-size floor plan with readable dimensions, including when dimension text says "EQ" or "VERIFY" or is simply wrong. On a correctly half-size sheet it read the true 1/16". **Zero wrong scales across the 20 holdout plans.**
- **Scans.** It refuses a scan ("This sheet is a scan") rather than guessing.
- **Materials math.** Given the right walls, the studs, track, board and insulation match a hand calculation exactly. There is now a test that keeps it that way.
- **Interior partitions on a clean plan:** 87% of the footage on Level 1, 95% on Level 2.
- **No phantom walls** on the cover, schedule, partition-legend and structural sheets. Revit's habit of drawing every wall edge twice no longer double-counts: #681's merge step fixed that.
- **Odd page setups:** rotated pages, offset crop boxes and Chromium-made PDFs all read correctly.

## What it gets wrong

1. **It misses about a third of the walls, and nothing tells you.** Clean Level 1: **1,410 ft found of 2,165 ft**. Interior walls 87%, **exterior walls 10%**. Level 2: 66%. Holdout: 84% on the plans it could read. If an estimator accepts what it found and posts it, Level 1 carries **32,100 SF of board instead of 52,900 SF**.
2. **On two kinds of sheet it gets the scale wrong, confidently.**
   - A half-size print whose title block still says 1/8": it takes the title block at its word, and every length comes out half size.
   - A sheet carrying two scales (an enlarged restroom at 1/4" beside an enlarged stair at 1/2"): it names one scale for the whole page with no warning, so the stair measures 2x long.
3. **Wall types of the same thickness get merged.** The acoustic to-deck wall (A2) and the standard partition (A1) are both 4-7/8". The 2-hour shaft wall (C1, 4-3/4") lands in the same group. They come back as **one group with one height**, so the estimate:
   - loses the acoustic insulation (**about 90% of insulation missing** overall);
   - loses the extra 4 ft of board up to the deck on every acoustic wall;
   - prices a shaft wall as an ordinary partition.
4. **It finds walls on sheets you must not take off.** Ceiling plan: about 1,350 ft. Mechanical plan: about 1,600 ft (ductwork, plus the walls repeated in the background). Elevations: 700 ft. Press "Find the walls" on the wrong sheet and accept, and that floor gets counted twice.
5. **AutoCAD-style "block" exports break it completely.** It finds zero walls and offers the sheet border instead. The cause is one missing case in the code that reads lines out of a PDF: it ignores the scale stored with each block. *Caveat: the real sheets tested so far evidently didn't hit this, so how common it is in real AutoCAD files is unknown. It is a cheap fix either way.*
6. **It counts things the drawing says not to.** Walls on a hidden layer, dashed walls marked for demolition, and walls outside a cropped viewport.
7. **Door and window schedules come apart.** Only **16 of 50 rows** reach the AI step as a clean row:
   - side-by-side schedules merge into one row;
   - a blank cell shifts every column after it;
   - title-block text splits rows.
8. **The addendum warning only works if someone typed in the sheet date**, and even then it says "go and check what moved" without saying what. The detected change in partition footage was off by 41 ft compared with the true change (-91 ft against -50 ft).

## The 5 most expensive bugs for a drywall sub

Dollar figures are **illustrative**, at an assumed $4–6 per SF of board with framing, hanging and finishing all in, Phoenix commercial. Change the rate and everything scales with it.

| # | Bug | Why it costs money | Size on Mesa Ridge (one floor) |
| --- | --- | --- | --- |
| 1 | **A third of the walls silently missing.** <br>• Exterior walls drawn as 4–5 lines (sheathing, foam, finish) are rejected as hatching. <br>• A T-junction can strand the short side of a wall. <br>• A grid line within about a foot of a wall cancels it. <br>• Furring is thinner than the minimum it accepts. <br>• The curved wall is skipped. | A short bid nobody sees. You win the job and eat the difference. | ~20,800 SF of board missing: **about $85k–$125k per floor**, roughly double for the building |
| 2 | **Wrong scale on half-size prints and multi-scale sheets.** | Every number on that sheet is 2x off, including hand-traced ones, because the hand tools use the same scale. | When it fires, the whole sheet. A full floor's board is ~53,000 SF (**~$200k–$300k**), measured at half or double |
| 3 | **Counting what isn't in scope**: phantom walls on ceiling and mechanical sheets; hidden layers, demolition walls and cropped areas. | Over-bid. You lose jobs you should have won, or count a floor twice. | An accepted ceiling plan: ~1,350 ft ≈ 30,000 SF (**~$120k–$180k**) |
| 4 | **Same-thickness wall types merged.** Acoustic to-deck walls are posted as the standard partition at ceiling height; the shaft wall is priced as a partition. | Missing insulation and 4 ft of board per acoustic wall; shaft wall underpriced. | ~2,900 SF of insulation, ~1,600 SF of board, the C1 shaft wall at A1 price: **about $15k–$25k per floor** |
| 5 | **Posting math drops board over openings, and studs.** <br>• Found walls stop at door jambs, so length × height leaves out the board above every door and around every window. <br>• An accepted group posts as one long wall, so it loses an end stud for every wall in the group. | A systematic short bid on every job that uses the tool. | **2,321 SF of board** (~$9k–$14k) plus ~15% of studs on short runs |

The AutoCAD block failure (item 5 in the list above) is not in this table because it fails *visibly*: there are no lines on the walls. It costs time and trust rather than a wrong number.

## Is it ready to be a free public "wall takeoff" tool?

**No.** A free public tool gets judged on its total, and today's total is about two thirds of the right answer on a clean drawing, with **exterior walls almost entirely missing** and nothing on screen admitting it. The code's own safety argument, *"a wrong line is visible on the drawing"*, covers phantoms. It does not cover misses, and misses are the bigger problem. The app's changelog says so itself: *"a missing wall is a short bid that nothing on screen reveals."*

What would change the answer, in order:

1. **Exterior and multi-line walls.** This is the biggest gap.
2. **The line reader.** Read the Form `/Matrix`, hidden layers and clip paths.
3. **Scale.** Never offer a printed scale on a reduced page, and warn when a page carries two scales.
4. **Wall types.** Read the wall-type tags so A1, A2 and C1 separate.
5. **Honesty.** Show a "found X ft; the drawing likely holds more" line until recall measures above 95% on this bench **and** on the holdout.

Until then it is a useful **assist** for an estimator who still checks every room. It is not a takeoff.
