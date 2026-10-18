### Read this sheet was unreachable on every sheet it exists for

A browser tester could not run the click-list for it, and the reason is a
deadlock I shipped:

- **Find the walls is disabled until the sheet has a scale** (`!calibration`),
  with the tooltip *"Set the scale on this sheet first"*;
- **a scan's scale is printed on the drawing and nowhere else** — there is no
  text layer to read it from;
- **reading the drawing is what Read this sheet does**;
- **and Read this sheet only appeared once Find the walls had run** and come
  back with no lines.

The one control that breaks the cycle was inside it. The only escape was to
set a scale by hand, which is the thing the feature exists to save you doing.

It is gated on the page having **no text layer** now — a fact settled at
ingest, independent of scale, of the wall finder and of anything the viewer
has done. `sheetIndexFor` already selected `hasTextLayer`, so the data was
there the whole time.

**Nothing in this repo could have caught it, and that is the entry worth
keeping.** `aiSurfaceCensus` asserts the control exists, sits in a real
component and is rendered from a page — all true, all green, on a button no
estimator could ever press. **A census reads SOURCE; reachability is a
property of runtime state.** It is the same shape as #764, where three
`required` radios on a sibling question made a perfect field unsaveable, and
it was found the same way: a person clicking.

The replacement assertion is one source CAN carry. Rather than "the button
exists", `readSheetReachable.test.ts` asserts the gate is INDEPENDENT of the
cycle — it must not mention `found`, `strokesSeen` or `calibration`, whatever
else is true of it. **6 of 6 mutations red**, the first being the shipped
deadlock restored exactly.

**The same report caught the opposite error**, and the fix covers it: Read
this sheet appeared on a VECTOR sheet, because `found` was left over from a
previously viewed sheet while `strokesSeen` had reset. Keying on the page's
own flag makes stale state impossible rather than unlikely.

**And the test harness for this failed its own control first.** The helper
that reads the gate out of the source walked back to the nearest `{`, which is
the button's own `disabled={reading}` — a seven-character slice. Two cases
failed loudly; the three asserting something was ABSENT passed, because
nothing is ever present in the wrong seven characters. The helper now asserts
the slice looks like a conditional before anything is read off it.
