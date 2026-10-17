## Detected walls read under the condition they belong to

The takeoff panel listed detected wall groups as a flat run of thicknesses —
`3"`, `4-3/8"`, `6"` — and left an estimator to map each one back to their own
conditions by eye. It now groups them under the condition each proposes into,
with everything unmatched under **Unassigned walls** at the bottom.

**The index is carried, never recomputed.** A group's position in the original
array is what addresses it everywhere else: the colour and dash it draws on the
drawing, the wall type chosen for it, and the hover that lights its runs. The
sections are a reading order over those indices, so the panel's third row still
highlights the drawing's third.

**One match point, because there are two ways in.** Groups reach the panel
seeded from stored proposals when the page loads, and straight from the
browser's own run when somebody presses Find the walls. Matching in the loader
covered only the first — the same screen would have shown headings after a
reload and not after the button. The match now happens where the two paths
meet.

**A stored match wins; a null is matched again.** Detection fires the instant a
scale is accepted, so on a job whose conditions are named afterwards — which is
most of them, because you scale a sheet to look at the drawing before you
decide what you are counting — every group stored a null. Those are re-matched
against today's items, so naming a condition sorts the groups under it without
a re-run. A stored value is a decision and stands; an absence is what is safe
to recompute. Ties are refused here exactly as detection refuses them.

**No test in this repo could see any of this.** `TakeoffPlanViewer` is a pdf.js
client component that nothing renders, and with the heading forced off — the
feature removed, every group back in one flat list — the whole suite passed:
2,542 tests, green. So the proof is a real browser: e2e step 21 finds the walls,
asserts no group is assigned and no heading is drawn, names a condition at a
thickness it reads off the panel, finds the walls again, and requires both the
heading AND a group underneath it. Mutation-tested — with headings forced off
it fails by name. A source census covers the wiring and is mutation-tested two
ways.

Also fixed: e2e step 20 waited up to 60s for the assembly library to seed
inside a test whose own budget was 30, so it could only pass when that branch
was skipped or happened to be fast. It failed three times while this was being
written, each time looking like a different bug.
