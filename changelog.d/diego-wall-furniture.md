### The sheet border came back as a 237-foot wall, because it is drawn in segments (Diego)

`diego/wall-furniture`

A browser run on Augusta A1.11 — **the first time anybody had pressed "Find the
walls" on a real drawing** — found 147 runs and ~1,324 feet, of which the
second-biggest group by footage was the drawing frame:

> the 6" group draws along the drawing border and the title-block frame… the
> border is roughly the full 168 ft sheet width

Pressing **Add these** on that group puts the paper's own frame into a bid.

The reporter named the hazard better than any test had: **"The total footage
looks plausible, which is the danger."** Same shape as the area takeoff that
came off this toolbar the same morning (#712) — a believable wrong number.

#### Why the existing filter missed it

`wallsNotTheSheetBorder` already exists, and its own header says it was written
because *"a real set offered [the border] as a 114ft wall."* It drops a run
spanning **≥90% of the sheet** — length only.

An architectural border is **four runs inset from the paper that stop short of
the corners**, plus the title-block frame just inside it. Each piece is well
under 90%, so every one of them passed.

**The new rule is the AND of length and position**, and mutation says why
neither half is safe alone: length alone drops a real exterior wall on a sheet
scaled to its building; position alone drops the outermost partitions of any
plan drawn close to the frame. Together they describe something no wall is — a
run that is both a quarter of the sheet long *and* inside the 4% strip at its
boundary. Nothing of the building is in that strip, because the border occupies
it and the plan is inside the border.

#### Three things this does NOT fix, said here rather than discovered

- **The title block is still counted.** Its cells came back as 4-3/8" walls, and
  those are short runs *inside* the border, so nothing here reaches them. Every
  cheap way to guess that region also drops real wall — a plan is routinely
  drawn right up to the title-block strip. The honest fix is multi-sheet: the
  frame, title block and logo are the only geometry at the **same page position
  on every sheet of a set**, which identifies them without guessing a corner.
- **Hatching west of the building.** `inAHatchSeries` exists and is evidently
  leaking; that is a separate measurement.
- **So Add is not safe yet.** This reduces the contamination. The group panel
  still has to be checked against the drawing by eye.

#### And a hazard found in the pre-existing rule, pinned rather than changed

Two of the new safety cases failed on fixtures spanning 94% and 96% — **not on
the new rule, on `MOST_OF_THE_SHEET`**, which has dropped any run over 90% of
the sheet at any position since before this change. So a building scaled to fill
its sheet loses its longest wall, silently: on Augusta's 168-foot sheet, every
wall over 151 feet.

Pinned in a test that says in as many words it is not approval. Changing it
needs a measurement on real sheets nobody has taken — the span rule is also the
only thing catching a border drawn as one unbroken line.

#### Checks

415 tests in `lib/takeoff`, **six mutations all red**: the segmented rules
removed (the bug as reported), position without span, the strip widened into a
title-block guess, the segment threshold raised until it is the span rule again,
the extent guard dropped, and only two of the four edges checked.

**Two false starts are recorded in the tests, because each produced a plausible
wrong thing.** A whole new `sheetFurniture.ts` module was written before anyone
looked — duplicating a filter that already existed, which is the "second list"
CLAUDE.md warns about; it was deleted and the logic moved into the function that
owns it. And the extent guard first used a **negative band** to mean "off",
which *inverted* the rule instead of disabling it: `pageHeight - (-1)` is larger
than the page, so every run read as hugging the bottom. A negative distance is
not a disabled distance.

No schema change. Preflight green.
