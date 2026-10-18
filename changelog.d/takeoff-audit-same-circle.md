### An opening joins two pieces of one arc, and nothing else

Joining curved pieces across openings put **19 curved runs — 176 ft — onto a
real forming plan that had none before**. On the drawing they sat on hatched
fill carrying evenly spaced blocking symbols, and on a stair's diagonal break
line: short parallel strokes whose ends line up, chained into something long
enough to pair as a wall. It is the corridor failure `mergeWalls` records,
arriving in the curve path, and that file's own note had named it as the thing
to suspect.

Two pieces are joined now only when they were drawn on the SAME CIRCLE — each
is given the circle through its first, middle and last point, and the centres
and radii must agree. That is the definition rather than a threshold: "a window
in a curved wall" means the wall continues on the same circle past the hole,
and hatching never was on one.

Three rules were tried against that sheet and the two that failed are why:

| rule | phantoms left |
| --- | --- |
| a chain must bend at all (3 degrees) | 5 runs, 27.7 ft |
| …and bend mostly one way (60%) | 3 runs, 33.1 ft |
| …and both pieces on the same circle | **0** |

The middle row is the one to remember: making the join STRICTER made the output
WORSE. Refusing one chain frees its neighbours to pair with something else, so
this is not monotonic and a rule here cannot be tuned by watching one number
fall.

Cedar Hollow holds at −0.6% with its three arcs exact (29.74 / 55.13 / 22.26
against a key of 29.71 / 55.14 / 21.99), the twenty fixtures and the bench are
unchanged, and all nine real sheets are back to their baselines — ELEVEN03
p117 to exactly 1,559 ft over 81 runs, with nothing added anywhere.

Mutation-tested six ways. The fixture took four attempts: a hatch field, two
arcs side by side and a tangent-continuous S all left every mutation green,
because each was refused by something else first — the thickness window, the
distance between the ends, and the fact that two faces swap sides at an
inflection. The case that survives is pinned at the setting where the rule
actually decides: **6.4 ft with it, 16.3 ft without.**

`A-131 STAIR AND SHAFT PLAN` joins the bench's zero-wall sheets with poché
bands, blocking symbols and a stair. Its docstring says plainly that it does
NOT reproduce this defect — the bench was run with the fix removed and the
zero-wall bar passed both times — so that nobody reads it as cover it does not
provide.
