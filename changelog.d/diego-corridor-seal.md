### The wall through the corridor was made by the opening SEALER, not the merge (Diego)

`diego/corridor-seal`

#726 tried to stop this in `mergeWalls` and could not. The fixture added in #727
said so in its own assertion: **95 gap checks, 23 refusals, ten runs still
crossing.**

#### Union-find is transitive, which is why a downstream fix cannot work

Refusing to join the pair either side of a corridor does nothing once some third
fragment bridges them — they land in one group anyway and the spans loop strings
them into one run. Moving the check to the spans loop was tried and **refused
zero joins**, so it was removed rather than left in as an unexercised safeguard.

#### Where the bridge was actually made

Measured at each stage on the fixture:

| | candidates inside the corridor |
| --- | --- |
| the line pairer | **0** |
| the region engine, `closeOpenings: false` | **0** |
| the region engine, sealing on | **6** |

`openingsInWalls` **sealed the corridor**, because a 5'-7" crossing satisfies
every test it has for a doorway: wall on each side, a gap between
`NARROWEST_DOOR_FEET` and `WIDEST_DOOR_FEET` (2 ft and 12 ft), all on one line.
Sealing it makes the corridor an enclosed thin region — and the region engine's
whole job is to call a thin region with a different space on each side a wall.

So it reported six, and the merge strung them into six **forty-foot** runs
through open floor. 40 ft is a room, the corridor, and the room opposite.

#### The discriminator is the same one, in the right place

A door is a hole in one wall and nothing crosses it. A corridor has its own two
walls running **across** the ends of the gap. That test now runs at the seal,
on raw faces — the earlier and more reliable evidence — and the crossings go to
zero while sealing still does its job everywhere else.

It degrades the safe way: if the corridor's walls were not drawn, nothing bounds
the gap and it is sealed exactly as before.

#### Checks

490 tests. **Seven mutations, all seven red** — the corridor sealed again, one
perpendicular face being enough, one wall's own two faces counting as two sides,
only one end examined, perpendicularity dropped, the distance read in page units,
and measuring to the infinite line instead of the segment.

**Three were green first**, and each is now a case taken from a real shape: a
door beside a T-junction (one wall at a jamb is extremely common), a narrow gap
where ONE wall's two faces both land within the bounding distance, and a
perpendicular wall eighty feet away lying on a line through this gap — which
gridlines make routine rather than freakish.

**And the fixture's `it.fails` marker did exactly what it was for.** It asserted
the defect was still present; the moment this fix landed the suite went RED,
which is what sent me to find the cause instead of leaving a note. It is now a
plain `it`.

#### What this does not claim

The fixture is a reconstruction — no drafting noise, no line-weight variation,
no dimension strings across walls. **A pass here is not a pass on the drawing it
came from**, and the count on the real sheet is still worth running.

No schema change.
