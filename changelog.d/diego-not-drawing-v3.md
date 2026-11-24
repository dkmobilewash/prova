# The title block behind the sheet's rightmost ruled boundary (NOT-DRAWING v3)

Behind `NEXT_PUBLIC_TAKEOFF_NOT_DRAWING=1` (unset = today exactly): runs inside the
sheet's own title-block strip are set aside from the customer offer. The strip's
vertical boundary is the RIGHTMOST chained full-height rule (collinear 0.002 W, gaps
≤ 0.02 H, span ≥ 0.85 H, x ≥ 0.70) with two distinct strong title words right of it;
a bottom band is the highest qualifying full-width rule in the bottom 15%. v2's two
casualties are both fixed by construction: leftmost selection gutted K-4 (its plan's
own full-height line qualified), and the text-block-box aside gutted Joplin (−732 ft
real from half-plan boxes) — v3 selects rightmost and removes the text-block aside
entirely (`textBlocks` plumbing stays for the planned run-model features).

Measured once per prereg-not-drawing-v3.md (51 training sets × OFF/ON, snapshot
labels-snap-20261121T0200): pooled junk+missed 24,733 → 24,425 (−308 ft), pooled real
−10 ft (0.018%, bar 0.5%), no set worse (Joplin/K-4/ELEVEN03/SW/Full Set named guards
held). Fresh-sheet bar: title-block ft inside a detected strip = 0 on all ten named
sheets; Singh A2.0's nine-run 100%-junk offer goes to 0. Residue without a detectable
boundary (Jane Hahan's 51.3 ft title runs; OTH's ~84 ft/sheet notes+legend) is out of
scope here and waits for the run-model features.

The check: `customerOfferNotDrawing.test.ts` grows the title-block guard on the
KNOWN-GAP shape — a single-view sheet whose strip rows are wall pairs. Flag off, the
rows ARE offered (the non-vacuity control, what Singh A2.0 showed live); flag on,
nothing inside the detected strip survives and the plan is untouched.
