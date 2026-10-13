### The page list is back on the left, on a laptop (Cyrus)
`cyrus/restore-nav-sidebar`

Concept G (#748) took the left rail away, and about half of what we built was
then reachable only through ⌘K or the avatar's "All pages". From `lg` up there
is a sidebar again: every page the viewer can open, under the six area names
from the home boxes (Jobs & bids, Money, Crew & field, Paperwork, Compliance &
safety, Materials & equipment), then the operator's Internal pages, then
Account. It is built from `pagesByArea(navGroupsFor(…))`, the same pair "All
pages" uses, so there is no second list to drift. Groups collapse; the whole
list collapses to icons; both choices are remembered per browser and survive
storage that throws. The current page carries `aria-current`. The top bar,
⌘K, the home boxes and the phone's tabs are unchanged; below `lg` nothing new
renders.

The check: `components/shell/sidebar.test.tsx` holds that an owner's list is
exactly `navGroupsFor` + the footer, once each (≥ 35 links), in area order,
and that a field user is never shown a page `canOpen` refuses.
`shellRegion.test.ts` now pins the sidebar's region and its fallback.
