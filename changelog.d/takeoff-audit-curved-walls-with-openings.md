### A curved wall with a window in it is one wall

An arc carrying openings came back as fragments totalling about half its
length. A held-out library plan measured it: its three arcs returned 58.0 ft
against 106.84 ft of drawn wall, in seven pieces, and the gaps between those
pieces were **4.00 ft and 2.99 ft** — the window and door widths from that
plan's own key, to the inch. The drawing stops and starts again on the other
side of each opening, so `assemble` had nothing to chain.

`joinAcrossOpenings` runs between assembly and the arc filters, joining chains
whose gap is an opening's width and whose direction continues through it, and
counting the opening in the length. The width is `mergeWalls`'s own
`MAX_OPENING_FEET` and `CAP_SLACK_FEET` rather than a second copy of "how wide
is a door". It is placed before the filters deliberately: `MIN_TOTAL_TURN` asks
whether a chain turns enough to be an arc, and a 7 ft fragment of a 26.9
ft-radius wall turns 14.9 degrees — just under the 15 it wants — so the
fragments were not merely short, they were discarded, while the wall they
belong to turns 117.

The three arcs now return 29.74, 55.13 and 22.26 ft against a key of 29.71,
55.14 and 21.99, and the sheet reads −0.6% with no run matching no key wall.

**Joining exposed a guard that was only ever safe by accident.** `totalTurn`
summed the ABSOLUTE turn at every vertex, so once a chain could run a whole
wall, a straight line drawn in many small pieces accumulated enough jitter to
pass as an arc: a real forming plan reported 113 curved runs and 974 ft, one of
them a 56.7 ft "arc" whose two endpoints have the same y. `MIN_TOTAL_TURN`'s
own note says what the test is for — "a dashed line turns 0" — and that is true
of NET turn, while summed wobble grows without bound in the number of pieces.
The turns are summed signed now and made absolute at the end, which still
accumulates past 180 degrees for a real arc and cancels for jitter.

Mutation-tested four ways, each red: no joining, the opening left out of the
length, joining without requiring the direction to continue, and the old
absolute-sum turn.

The first version re-ran the whole pairwise scan after each join and took the
bench past fifteen minutes from ninety seconds; it grows each chain from both
ends instead, the way `assemble` does.

`zzHeldout.eval.ts` runs the product's pipeline over one PDF named by
`HELDOUT_PDF` and prints what it found. It reads the DRAWING and has no way to
reach a key — `truthWall.test.ts` enforces that for held-out plans the same way
it does for the twenty fixtures' committed truth, since a detector that can see
the answer is not being measured.
