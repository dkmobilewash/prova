### C Stream Bid's landing page: one animation does the explaining (Cyrus)
`feat/bid-landing-redesign`

The old page was accurate and all text. On a phone it ran to about 3,000px of the same box, and nothing showed "you never type the number twice". Founder's direction on 2026-10-26: simpler, less space, and one big clean animation worth two paragraphs.

**The hero is now one example job, playing on a 12-second loop:**
- the invite lands;
- the walls draw themselves on the floor plan;
- footage appears by wall type, with the doors and windows found;
- the bid recap adds up;
- the lit-up bid total travels down onto the lump-sum proposal.

That last move is the promise: the number is carried, never retyped. It is one SVG in the app's colour tokens, so it scales to a phone and follows the light theme, and it uses CSS keyframes with no JavaScript. Every element's resting style is its final frame, so a visitor whose device is set to reduce motion sees the finished job rather than an empty box. It is labelled "Example job" on screen.

**The rest of the page is reduced to:**
- the four steps, one line each;
- one paragraph for "The AI reads. It never does the maths.";
- one closing call to action.

Page height went from 3,982px to 1,534px at 1280 wide, and from 6,743px to 2,370px at 375.

**No pricing, no testimonial, no customer names.** `app/bid/page.test.ts` allows dollar figures only inside the one `data-bid="example"` block, which must say "Example job" and show the same total twice. Its visible words, with the animation's own `<style>` stripped, must hold no price or percentage claim. Everything outside it is still held to no figures. Checked by inserting "$99 per month" and "30% off" outside the block: both go red.

**Measured in Chromium against the compiled CSS:**
- no sideways scroll at 375, 768 or 1280;
- every link reachable by Tab, in order, with the focus ring;
- the light theme renders;
- the animation stepped frame by frame through the whole loop, with the total landing in its slot on the proposal.
