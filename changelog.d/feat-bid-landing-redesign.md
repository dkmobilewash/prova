### C Stream Bid's landing page shows the promise instead of only saying it (Cyrus)
`feat/bid-landing-redesign`

The old page was accurate and all text: four identical cards, then two more, 3,000px of the same box on a phone, and nothing showing "you never type the number twice". The hero now draws **one example job** through the four steps (invite → walls → bid recap → proposal) with the same bid total lit up at the recap and on the proposal. It is HTML in the app's own tokens, labelled "Example job" on screen. Below it: the four steps as one connected line; four detail rows (bid log, takeoff, estimate and recap, proposal) covering what this branch built (paste an invite, the same job from several GCs, a price for each GC, the scale picker, proposed openings, price updates, lump sum / by scope / itemized); the unchanged "The AI reads. It never does the maths." band and its limits; who it is for; one closing call to action.

No pricing, no testimonial, no customer names. `app/bid/page.test.ts` now allows dollar figures inside exactly one `data-bid="example"` block that says "Example job" and shows the same total twice. Everything outside it is still held to no figures and no invented statistics. Checked by inserting "$99 per month" outside the block, which goes red.

Measured in Chromium against the compiled CSS: no sideways scroll at 375, 768 and 1280; every link reachable by Tab in reading order, each with the focus ring; the light theme renders on its own tokens.
