### The model that judges a wall has been graded for the first time

`labelWallCandidates` has shipped behind the AI switch and a "Check these are
walls" button since it was built. Its header carries ONE measurement — an
apartment plan where it rejected counters, tubs and reference lines and left the
structure intact — recorded honestly as the anecdote it is. Nobody had ever
scored it.

It is worth scoring now because it is the only instrument left for the thing
geometry cannot do. Two deterministic attempts at the same problem were measured
against a real drawing this week and both failed: repeated-shape detection
caught **13%** of a parking plan's cars while wrongly catching **1%** of its
walls, and the structural route does not exist at all — every real export
explodes its blocks, so there are no Form XObjects to count.

### What it scores against, and the asymmetry that decides the verdict

`bench/wallClassify.eval.ts` runs the product's own path on a bench sheet,
renders the crop the viewer renders, and grades every label against
`gradeWalls`'s answer key: `TRUE` is a real wall, `PHANTOM` is line work that
is not one.

|  |  |
| --- | --- |
| kept a phantom | **cheap** — it is on screen in its own colour and a person rejects it in a second |
| dropped a wall | **dear** — invisible, and it reaches a bid |

So the number that decides whether this may ever run UNASKED is **real walls
wrongly labelled**, not overall accuracy.

### The first run was about the harness, not the model

It rendered the whole 36-inch sheet at 1,600px and reported the model dropping
**21 of 60 real walls**, calling a 208ft wall a dimension string.

That is about **44 DPI**, at which 1/8in lettering is five pixels tall and the
candidate numbers drawn beside each run cannot be read at all. The prompt's own
header does this exact arithmetic and concludes **"A CROP, NOT THE SHEET"** — so
the harness was asking the model to read something illegible and the failure was
mine. The sheet is tiled into 600pt windows now (~190 DPI, the figure that
header names as legible, and what the viewer produces at a working zoom).

**A number from a broken instrument is not a result**, and this one would have
condemned a feature.

### What it actually scores

| sheet | walls kept | phantoms caught |
| --- | --- | --- |
| A-101 (floor plan), prompt `.2` | 47/60 — **13 lost** | 1 of 4 |
| A-101, prompt `.3` | **57/60 — 3 lost** | 1 of 4 |
| A-111 (all phantom), prompt `.2` | — | 2 of 12 |

**The verdict: it must not run unasked.** Even at its best it drops three real
walls per sheet to catch one phantom, and on the sheet where it should shine —
a reflected ceiling plan where every single candidate is a phantom — it caught
two of twelve. As a button a person presses and reviews, it is defensible. As
something that runs by itself on every sheet, the asymmetry says no.

### And the grading immediately found a prompt defect

Of the thirteen walls `.2` dropped on A-101, **nine were consecutive chords of
ONE curved reception wall** — a 22ft-radius partition the answer key calls an
A1 — each rejected in as many words for being *"part of a continuous curve, not
a straight run"*.

`.2` said *"a wall is TWO STRAIGHT PARALLEL LINES"* and *"an outline that curves
… is an OBJECT"*. That rule was written to catch a car's bodywork, and it was
catching radius walls, which architects draw constantly.

`.3` moves the test from HOW IT BENDS to WHAT ITS OUTLINE DOES: an object closes
on itself or tapers and stands free; a wall's two faces stay a constant distance
apart and end on other walls, whether straight or concentric. Vehicles stay
named first in the not-a-wall list, and "closes on itself or tapers" is exactly
what a car's outline does.

**13 walls lost → 3**, with phantom detection unchanged on that sheet.
`wallClassifyPrompt.test.ts` now guards the regression directly: the word
STRAIGHT may not come back as the thing that defines a wall.

### What is NOT measured, and it is owed

**The all-phantom sheet was never re-run under `.3`.** The Anthropic credit
balance ran out mid-run — `invalid_request: Your credit balance is too low` — so
`.3`'s cost on the phantom side is measured on A-101 (unchanged, 1 of 4) and
nowhere else.

The relaxation is narrowly argued and the vehicle rule is untouched, but that is
an argument and not a measurement. **Re-run `CLASSIFY_CASES="A-111:clean"`
before trusting `.3` beyond A-101.** It is one command and it is written down
here rather than left as a thing somebody assumes was done.

### The other thing it reports, unverified

The model also names walls it thinks the geometry MISSED — 43 to 46 per sheet.
Nothing checks those, and they are not counted in any figure above. They may be
real misses, which would make them the most valuable output here, or they may be
invention. **Grading them needs a different key** (the bench knows which walls
were missed, so it is buildable) and it is not built.

### Verified

- `./scripts/preflight.sh` green. No schema change, no migration.
- The eval carries its own controls: candidates must have reached the answer key,
  and at least one window must have been sent. Without both, every figure it
  prints is about a comparison that never happened.
- It demands `ANTHROPIC_API_KEY` at collection scope, so a run without one fails
  rather than scoring a clean zero — the vacuous green this directory exists to
  end. `ask/eval/harness.test.ts` enforces that for every eval and this one
  needs no exemption, because unlike the other takeoff evals it really does
  call a model.
