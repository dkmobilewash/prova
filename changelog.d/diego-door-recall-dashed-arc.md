### A dashed door swing is one arc: Broadway's doors start being found (Diego)
`diego/door-recall-dashed-arc`

Broadway A1.0 draws its door swings dashed, so each dash read as a separate ~9-degree "arc" and none
of its 14 key doors was found. `arcChains` now carries a chain across a gap of at most 0.6 ft when
the next piece starts ahead of the last one (within 35 degrees of its heading) and turns the same
way. A piece beside the last one, or the dashes emitted backwards, still starts afresh.

Measured on the training opening table (labels-snap-20261117T0637, Round 25 with NG Green Bay's
phantom key doors removed, plan comparison where the product pairs, on main with #1201): matched key
doors 391 -> 396 of 459 (85.2% -> 86.3%; Broadway 0 -> 5), false found doors 25 -> 25, no set worse. Broadway's other dashed swings join only part of the way (about 69 of
90 degrees), so their arc's end misses the leaf; they are left for now.
Check: `doorWindowSymbols.test.ts` (dashes join; reversed, spread or sideways pieces do not; the
joined arc keeps every dash's ends; 4 mutations red).
