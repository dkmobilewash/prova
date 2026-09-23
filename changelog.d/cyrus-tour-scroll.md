### The walkthrough card stays on screen, and reaches sections a smooth scroll missed (Cyrus)
`cyrus/tour-scroll`

Clicked #323 on /dashboard: from step 2 on, the page dimmed with no card
and no outline in sight. Measured in the page — the card was at 1,382px on
a 740px screen. `placeCard` tried "below the element", then "above the
element", and checked "above" only against the TOP of the screen, so an
element still below the fold took the card down with it. Every placement
is now checked against both edges (two tests, red first).

Two more, because the app scrolls inside `<main>` and not the window:
if the smooth scroll to a step does not happen (a browser drops it for a
tab it is not painting, or another scroll interrupts it), the tour jumps
there after 700ms when less than a readable slice is on screen; and the
outline follows scroll and resize events, not only animation frames, which
a browser also stops for an unpainted tab. #323's agent tested on a
throwaway page whose window scrolls, which is why none of this showed.

Checked on /dashboard: the card is on screen for all eight steps stepped
through (top ≥ 284px, bottom ≤ 724px on a 740px screen).
