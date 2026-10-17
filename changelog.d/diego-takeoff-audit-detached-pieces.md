### A building can be in more than one piece

`wallsInTheBuilding` groups what survives the noise filters and kept only the
**biggest** group. That loses a detached wing, a plan split by a courtyard or
an atrium, and the far side of anything more than `SAME_BUILDING_FEET` away.

Found by bisecting the filter chain on real sheets rather than by looking: the
step was taking one 32 ft run at 6-1/8in and four 18 ft runs at 12in — the
proportions of walls, not of furniture. Keeping substantial pieces recovers
**153 ft over 7 runs on ELEVEN03 A4.B-Y2**, 11% of that sheet.

**A share of the biggest, not a footage.** The thing being separated is
scale-free: a second wing is comparable to the first, while the strays this
function rejects are an order of magnitude below. A fixed footage would have to
be right for a studio and a hospital at once. A tenth, chosen generously
towards keeping walls — dropping a real wing costs a bid that misses a wing,
and keeping a stray costs a run an estimator can see and delete.

**And footage alone was not enough, which this repo's own test caught rather
than any reasoning.** A title block of two runs at 80 ft against a 560 ft plan
is 14% of it, and a tenth kept it. Footage says how big a thing is; it cannot
say whether it is a drawing. So a second piece must also carry more runs than a
rectangle has sides.

The cost of that is named rather than hidden: a detached outbuilding drawn as
four walls with nothing inside is dropped. Reaching it is not worth admitting
every rectangle on the page — and the floor is **not** applied to the main
group, where a one-room building is also four runs and a count standing in for
that question once returned nothing on three real plans.

Measured across the change: the twenty fixtures hold at 15 of 17 within 2%, the
bench is identical including its zero-wall pass, and on the real sheets only
A4.B-Y2 moves. Alden's A103 briefly gained a 2-run box under the share alone
and correctly loses it again under the run floor.
