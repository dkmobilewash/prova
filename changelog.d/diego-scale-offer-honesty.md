### The offer said one thing two ways, and a saved scale said nothing at all (Diego)
`diego/scale-offer-honesty`

Three defects a click-through found on production after #663. **None was a wrong
calculation** — which is why every gate was green through all of them, and why
the two formatting decisions now live in tested functions instead of inline in
JSX.

## One — the error band printed a FLOOR as though it were the measurement

The offer read `band < 0.05 ? "0.05" : band.toFixed(2)`. So a pair accurate to
**0.01%** was reported as *"Within 0.05%"* — while the note written beside it
said **0.01%**, because that one formats the real figure. The click-through
caught the two disagreeing and reported it as a defect. It is one: a single
quantity shown two ways, in the number a reader uses to decide whether to trust
any of this.

Rounding up to a floor is fine in a progress bar and wrong here, and note the
direction — it **overstated** the error, making the feature look worse than the
evidence warrants. Below a hundredth of a percent it now says `under 0.01%` as
an inequality rather than inventing a value, because `toFixed(2)` of 0.004 is
`"0.00"` and that claims perfection.

## Two — a saved scale showed nowhere where it came from

Since #655 the reader writes its own account into `TakeoffScaleCalibration.note`:
which dimensions it matched and how closely, or that it used the printed scale
with nothing confirming it. That is **provenance** for a number that multiplies
every quantity on the sheet.

It was rendered only INSIDE the draft form — and a sheet whose scale is already
set has no draft, so **saving it made it invisible.** The click-through went
looking on two sheets that saved successfully and reported, correctly, that
nothing on screen said which way either scale had been set. Stored and shown
nowhere is the *"written, documented, and never called"* shape wearing a database
column.

`note` now travels on `PlanViewerCalibration` and the panel opens with *"How this
sheet's scale was set: …"*.

## Three — the evidence row could contradict the sentence above it

The row shows the first six of what can be 117 matched dimensions; the sentence
quotes the ONE pair being proposed. On a real sheet with 24 matches that was
*"Within 0.17% on 25' - 0 1/2""* above a row **not containing** `25' - 0 1/2"`.
Both true, and it reads as an error. The quoted dimension goes first now.

## What was investigated and NOT changed

The click-through flagged two non-plan sheets of a 29-sheet set — a code-analysis
sheet matched at 19% of its dimensions and a special-inspections sheet at 11%,
the latter's title block reading `AS NOTED` — and asked whether those matches are
real. **A confidence threshold on the agreement fraction was measured and
rejected:**

| sheet | agreed / found | fraction |
| --- | --- | --- |
| Salina p45 | 15/38 | 39% |
| Salina p32 | 14/41 | 34% |
| Salina p19 | 50/199 | 25% |
| *the code-analysis sheet* | 3/16 | **19%** |
| Salina p27 | 8/55 | 15% |
| **Salina p31 — an ordinary plan sheet** | 4/34 | **12%** |
| *the special-inspections sheet* | 4/35 | **11%** |

**A legitimate plan sheet sits one percentage point above the most suspect one.**
Any cutoff that rejects the latter rejects the former, so there is no honest
threshold there and fitting one to these seven sheets would be a number invented
to pass — the thing this repo's own guards exist to catch. The fraction is
already shown to the estimator (*"matched 4 printed dimensions of 35 found"*),
which is the evidence they need to decline it themselves.

Neither match is known to be WRONG: that file cannot be read from this machine
(`EPERM`), so there is no ground truth for either, and the sheets may well carry
real small-scale diagrams. Recorded so the next person does not re-run the
measurement.

## Verification

- 26 tests in `takeoff-plan-view-scale.test.ts`, 4 of them the exact
  contradictions reported.
- **Five mutations, each red**: the shipped floor; `toFixed` alone (prints
  `0.00%`); the shipped evidence order; the provenance prop never passed; the
  provenance prop passed and never rendered. Restored by rewriting bytes.
- The census states what it **cannot** prove — that React renders it. A census
  proves code is THERE, never that a framework honours it. The difference here
  is that nothing is handed to a navigator: it is plain JSX in the component's
  own return.
- Four gates: **9,269 unit tests, 680 db tests**, typecheck, lint. No schema
  change, no migration.

## Click-list

1. Open a sheet whose scale is already set and press **Set scale**. *Expected: a
   line at the top reading "How this sheet's scale was set: …". That box was
   empty before and is the point of this PR.*
2. On a sheet offering a dimension, read the **"Within …%"** sentence and the
   grey row above it. *Expected: the dimension named in the sentence is the FIRST
   one in the row. Never a sentence quoting a dimension the row does not list.*
3. On a sheet matched very closely, check the sentence. *Expected: "Within under
   0.01%", never "Within 0.05%" next to a note saying 0.01%.*
4. Press the button and save. *Expected: unchanged from #662 — it saves.*
