### A sheet you cannot see all of, and a button you cannot find (Diego)
`diego/plan-viewer-fit`

Both reported from a real 29-sheet plan set within an hour of #666 going live.

## One — no zoom showed a whole sheet

`ZOOM_STEPS` multiply the viewer's `BASE_SCALE` of 1.5, so the old floor of
**0.5 rendered at 0.75 of full size**. A 42-inch ARCH E sheet is 3,024pt wide,
about **2,270 CSS px** at that scale — wider than the box it sits in. The control
said "50%" and the drawing still ran off the edge, with nothing further out to
press. The percentage shown is the step, not the render scale, which is why 50%
was never half of anything.

**Steps alone cannot fix it:** the right zoom for a whole sheet depends on the
sheet AND the window, so no fixed list contains it. So there is now a **Fit**
control that computes the exact scale, and it is the state a sheet **opens in** —
somebody opening a drawing wants to see all of it, then zooms IN to measure. It
is a MODE, not a step, so resizing the window keeps it fitted (`ResizeObserver`).

Steps below the old floor were added too (0.15, 0.25, 0.33), and − / + now step
off the **current rendered size** rather than a remembered index — so pressing −
on a fitted 42-inch sheet makes it slightly smaller instead of suddenly enormous.
Fit is a computed scale that is not in the list, so an index could not describe
it at all.

## Two — "Find the walls" was hidden, not disabled

The gate is structural and unchanged: `wallVectors` asks *"is this thinner than
2-1/2in"*, so without a calibration there is no feet-per-unit and every bound in
it means nothing.

**Hiding it was the mistake.** Somebody opened a sheet, went looking for the
button they had been told about, and found nothing — no error, no explanation,
just an absence, which reads as *"this feature does not exist"* rather than
*"this sheet needs a scale first"*. It is now on the toolbar either way, disabled
with a `title` saying what is in the way, which is exactly the posture the
measuring tools beside it already take.

**That is the third defect of this shape this week** — #665's re-read button, the
provenance stored and never shown, and now this. A capability nobody can see is a
capability nobody has.

## Verification

- 24 tests in `takeoffWallFinder.test.tsx`, including the exact reported states:
  the button present-and-disabled with no scale, and Fit as the opening state.
- **Seven mutations, each red** — among them *the button goes back to hidden*
  (what shipped and was reported) and *the old zoom floor restored*. Restored by
  rewriting bytes.
- The existing test asserting the button was ABSENT went red when the behaviour
  changed, which is the guard doing its job; it was rewritten, not deleted.
- The client/server boundary census caught `stepZoom` and `ZOOM_STEPS` exported
  from a `"use client"` module — the same thing it said about `inchLabel` one
  commit earlier. Both live in `lib/takeoff-plan-view.ts` now.
- Four gates: **9,311 unit tests**, db suite, typecheck, lint. No schema change.

## Click-list

1. Open any plan sheet. *Expected: the whole sheet is visible, **Fit** is
   highlighted, and the percentage reads whatever fits — on a 42-inch sheet,
   around 30%.*
2. Press **−**. *Expected: it gets smaller, not bigger. It used to be impossible
   to go below 50%.*
3. Press **Fit**. *Expected: back to the whole sheet.*
4. Open a sheet with **no scale set**. *Expected: **Find the walls** is visible
   and greyed out; hovering says to set the scale first. It used to be absent
   with no explanation.*
5. Set a scale on it. *Expected: the button becomes pressable.*
