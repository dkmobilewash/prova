### The room finder comes off the toolbar, because it was confidently wrong (Diego)

`diego/hide-room-finder`

#702 shipped **Find the rooms** this morning. It was clicked on real sheets the
same day, and the answer was wrong in the way that matters most: **confidently
low**.

On a West Herr floor plan it reported **46 rooms and 4,555 sf** for a building
about 290 ft across. It had missed Showroom 101, Sales 103, Hospitality 105,
New Car Delivery 140 and the whole right-hand wing — while outlining **a parked
car**, the gaps between dimension strings, and two keynote tags. On Augusta,
Conference 1102 came back cut in half along its own 15'-8" dimension line, and
an outline ran diagonally across Mechanical 1101 along the "EXISTING HVAC"
leader.

An estimator who trusts that bids half a building. That is worse than having no
feature, so it is gone until its numbers say otherwise.

#### Every symptom is one cause, and it is not a threshold

`roomAreas.ts` rasterises **every stroke the sheet carries**, and a floor plan
is not only walls:

| | |
| --- | --- |
| a leader line crossing a room | cuts its region in two |
| a dimension string | encloses a region of its own |
| a keynote tag, a car, a desk | is a closed outline, so a region |
| **the biggest rooms** | are the most crossed, so the most fragmented — which is exactly why they are the ones that vanish |

`wallVectors.ts` has `wallsNotLettering`, `wallsInTheBuilding` and
`wallsNotTheSheetBorder` for precisely this, each added after somebody looked at
real output. **The room finder has none of them.** The box does not help: every
one of those strokes is inside it, drawn on top of the plan.

The amber "something standing in it" flag was firing on tag bubbles and door
swings rather than columns, for the same reason.

#### The check I should have made and did not

I rendered the regions as flat colour and asked *"do these look like rooms?"*
They did — that is why I shipped it.

The question that finds this in a minute is the other one: **"is Showroom 101
among them?"** A detector is judged by what it MISSES, and a picture of what it
found cannot show that. My Augusta render looked convincing and I never once
asked what was absent from it.

#### What is kept, and what holds it

`roomAreas.ts` and its 13 tests stay. The geometry is right —`traceRing`, the
ring maths and the mutation work all hold. **What is wrong is what reaches
them**, so the module keeps its tests and gains a header recording the
measurement above.

`takeoffRoomFinder.test.tsx` is **inverted rather than deleted**: it now asserts
the toolbar offers no such button. The old version asserted the button was
reachable, not hidden by an attribute or a class, with a census of its call
site — and every one of those was true the whole time the feature was broken,
because reachability says nothing about whether an answer is right. Deleting the
file would leave nothing between the next person and three lines of JSX.

The wall finder is untouched and still measured at 94.5% recall; manual area
tracing is how this was done before #702 and how it is done now.
