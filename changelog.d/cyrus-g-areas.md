### Six area boxes on the home page, each opening onto a page with everything it holds (Cyrus)
`cyrus/g-areas`

The owner's words on Concept G: "you can't see where anything is and I don't
want people to have to use search all the time". Concept H answers it. Under
the greeting sit six boxes: Jobs & bids, Money, Crew & field, Paperwork,
Compliance & safety, Materials & equipment. Each box shows one live line:
"$64,920 overdue", "2 RFIs waiting", "3 crews out today". When there is no
cheap real count, the box shows the area's plain description, never a made-up
number. Clicking a box opens a dropdown with that area's tools, each with a
real count where one is cheap, ending in "Open <Area> →". On a phone the
boxes become two-column tiles that go straight to the area page.

`/areas/[slug]` shows every tool in the area as a card with its count and
one action. Below the cards is one combined list of what in that area is
waiting on somebody. For Paperwork that is RFIs and submittals out with the
GC, oldest first. For Money it is overdue invoices and lien deadlines. For
Crew & field it is today's crews and hours to approve. For Compliance it is
expiring documents. For Materials it is open orders, late first. For Jobs &
bids it is bids due and estimates out. The top bar's Money now opens the
Money area. "All pages" and search both list the six areas.

`lib/areas.ts` files every nav destination in exactly one area.
`lib/areas.test.ts` derives the set from `NAV_ITEMS`, so a new nav entry
with no area (and no written reason in `NOT_IN_AN_AREA`) fails the build.
Visibility reuses `canOpen`/`canReach`, so no box offers a page that would
refuse the viewer, and an area left with nothing openable is hidden. FIELD
has no Money box. Both checks were mutation-tested: dropping `/team` from
its area failed the partition test, and removing the capability filter
failed the visibility and hidden-area tests.

The job Overview's own row of paperwork links is gone, because the job
page's Paperwork panel already carries the same links.
