### Scoring: a key point on a door's hinge jamb is that door's, not a neighbour's (Canton 121; totals unchanged, the right door now gets the credit)
`diego/door-match-nearest-edge`

The pair scorer (`openingLabels`) pairs a key point with a found door's swing when the point is inside the swing or
within 2 ft of its edge, closest pairs first. "Closest" was measured to the swing's CENTRE, the mean of the hinge and
the arc's points, out by the arc. A key point on the hinge jamb (Mid-City keys every leaf there; Canton A101's
WOMENS 121 is keyed that way and Diego ruled the key correct) lies on its own swing's edge but about a door's width
from that swing's centre. So a neighbour whose edge was within reach and whose centre was nearer took it. On Canton
that neighbour was the first toilet-stall door inside WOMENS 121, which was credited with 121's key while 121 itself
counted as false.

Closest pairs are now ranked by distance to the SHAPE: inside is 0, otherwise the nearest edge. This is an eval
correction, not a finder change.

Measured on labels-snap-20261119T0330 against main ed58fe2f: every training and retired number is identical
(training 979 posts / 891 real / 88 false, matched 937 of 1027; retired 193 / 183 / 10, matched 201 of 256; the
three precondition conditions unchanged). Exactly two door rows change in the whole table, both on Canton: 121
becomes matched and the stall door unmatched, as the key convention and the stall-door ruling say.

Checks: a unit test with a hinge-jamb key point, its own swing, and a neighbour whose centre is nearer. Restoring the
centre ranking turns it red.
