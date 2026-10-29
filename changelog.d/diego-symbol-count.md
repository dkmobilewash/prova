### "Count like this": every copy of a boxed symbol, behind a switch

**Why.** Togal counts fixtures by finding every copy of a symbol; here a
count was one click per fixture.

**What.** `Company.symbolCountOn`, OFF, under Settings → Estimating. With
it on, a "Count like this" tool on the takeoff: drag a box round one
symbol and every instance on the sheet is marked — turned or mirrored,
the text-layer lettering beside it ignored, whatever it touches ignored.
Click a mark to drop it; save the count as a COUNT measurement named like
any other. The match is rigid: the template is laid over the sheet
anchored on its heaviest strokes and scored by how much of its ink lands;
three earlier versions were measured off on the way
(`lib/takeoff/NOTES-symbols.md` §2). On five hand-keyed symbols across
Baker, Bunkie, Crosslines and Topeka: 84 of 84 found, no false, 0.2–14 s
per search. Not across sheets yet (§4).

**Check.** `symbolSignature.test.ts` (invariance, a different symbol,
text, the finder on a synthetic sheet), the switch's db test, and
`realplan/symbolCount.eval.ts` against the keys outside git. Migration
additive (one boolean). No e2e run.
