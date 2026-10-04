### A pin on a drawing, in the coordinate system that was already here (Diego)
`diego/plan-pins`

One additive migration (`20261004210000_add_sheet_pins`, 13 statements, no
drops). Flagged in `#prova-build` before a line was written, per rule 4.

**What it does.** Open a drawing revision, tap the sheet, and drop a PHOTO,
PUNCH or NOTE pin at that spot. The pins list under the drawing; removing one
is two steps.

**THE COORDINATE SYSTEM WAS NOT INVENTED, IT WAS EXTRACTED.** `takeoff-plan.ts`
already defined the page-width box — `x` 0..1 and `y` 0..H/W, **both divided by
the width** — and a second definition of that is exactly the "is there a second
list" failure this repo keeps paying for. It now lives in
`lib/sheet-geometry.ts`, imported by both; `takeoff-plan.ts` re-exports it so
its four importers resolve unchanged, and its 35 tests pass untouched.

The header of that file now also says the thing nobody had written down:
**there are TWO conventions here and both are right.** A `JobMediaAnnotation`
normalises each axis by its own extent, which is fine for a point on one photo
where nothing is ever measured between two marks. A SHEET carries lengths, so
distance must be computable from the stored numbers alone. Do not unify them —
that is the drift, not the fix.

**Why a pin is not a `TakeoffMeasurement`**, which was the obvious reuse and is
wrong: `calibrationId` is REQUIRED there, because a measurement with no scale
is meaningless. A pin needs no scale — you pin a photo to a wall without
telling the app how big the wall is. Reusing that table meant making
calibration optional, i.e. weakening the measurement model to serve a different
feature.

**The y-axis is the whole bug surface, so the fixture is 42x30.** On a D-size
sheet `y` tops out at 0.714, and `y = 0.9` is a perfectly good fraction that is
off the bottom of the page. A SQUARE fixture passes every test here while that
bug sails through, so there isn't one.

| mutation | result |
| --- | --- |
| control | green |
| **`y` treated as 0..1 of the height** | **RED** |
| only the first vertex of a shape checked | RED |
| a self-crossing ring accepted | RED |
| a pin whose target was deleted renders as normal | RED |

**SetNull, not Cascade, from a pin to what it points at.** Deleting the photo
does not delete the pin: somebody stood on that spot and flagged it, and that
outlives the attachment. It renders as "Photo (removed)" — honest — rather than
vanishing and taking the knowledge that anything was flagged there with it.

**Page geometry is read by the BROWSER, deliberately.** pdf.js is already open
to display the drawing, so the page count and each page's size at `scale: 1`
are free there. The server would need `@napi-rs/canvas` to get them, which this
app does not carry. Nothing trusts those numbers for money —
`@@unique([revisionId, pageNumber])` with `skipDuplicates` means the first
reader's numbers win — and a wrong one misplaces pins for the person who sent
it and nobody else.

**SEVEN CENSUSES CAUGHT THIS BRANCH AND EVERY ONE WAS RIGHT**, which is worth
recording because it is what they are for: the export completeness census (3
models in no bucket), the numeric-input census (a bare `Number()` on a Server
Action, which answers whoever posts to it), Ask's command coverage, the
reachability census ("written, documented and never called"), the
capability-guard walk, `rowActionsCensus` (a hand-rolled armed delete instead
of `ConfirmDeleteButton`, which owns the measured phone-column geometry),
`pageWidthCensus`, the spinner census and the inbound-link census.

**One census has a blind spot worth knowing about.**
`action-capability-guards.test.ts` reported `ensureSheetPages` as having NO
capability guard when it has the same one as its three neighbours. The
difference was that its signature spanned four lines. Flattening it turned 17
failures into 529 passes with no change to the guard. It fails SAFE — a
multi-line unguarded action is still flagged — so this is a false positive and
a time cost, not a hole. Filed rather than fixed inline: the census is a
security check and ships with its own work.

**Markup (arrows, clouds, text) is NOT in this PR.** It was built, and its
actions had no caller because the UI is a second thing — the reachability
census said so. Rather than half-build both, the model and actions came back
out and pins ship whole. That is rule 1 working as written rather than being
argued around.

568 files / 8846 tests, typecheck, lint and a full production build clean.
