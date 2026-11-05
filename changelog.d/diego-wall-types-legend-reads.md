### A legend that spans pages is read as one legend, and every set's legend has now been read (Diego)
`diego/wall-types-legend-reads`

The WALL_LEGEND stage saves one proposal per page, and the stored legend
(`planTextRead.ts` `legendFromProposal`) took only the NEWEST of them. Most
legends span pages, one per partition family, so a set typed its walls from
whichever page finished last: Gen-BBQ kept 1 of its 29 types, Murray Towers
3 of 7. It is now every page of the newest read, merged by code, lowest page
first. Measured on held-out (measure only), typed 15.0% → 15.6% of 38,396 ft.
`storedLegend.dbtest.ts`; a take-one mutation turns it red.

`realplan/zzLegendReadAll.eval.ts` runs the stage's own `wallLegendWork` over
every page of a set with its dependencies pointed at files, caching each model
call by set, page and prompt version. Over all 55 sets: 272 calls. Legend types
found on 17 of 36 training sets and 15 of 19 held-out; no legend on Hillside,
Evergreen (scanned), Albany or Darrington.

Ideas b–d (carry a type through the set by thickness, U.N.O. scope by
material, hatch ↔ masonry swatch) were prototyped against the eval's per-run
output and scored on the two type-keyed training sheets (Baker A101, Joplin
A-101, 2,018 ft). None raised typed-correct footage (1,193 ft for each). (b)
and (c) added wrong footage, and (d) changed nothing that is keyed. None is
built.
