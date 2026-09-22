### The landing page's Ask demo stops sliding sideways under itself (Cyrus)
`cyrus/landing-demo-layout`

#457 put the Ask demo on the public landing page in a cell pinned right
with `lg:justify-self-end`. `justify-self` sizes a grid item to
**fit-content**, and the demo's frames are not all the same width — so the
cell shrank and grew with whatever frame was on screen, and because it is
pinned to the right-hand edge, all of that movement came out of the LEFT
edge. On a desktop the scene slid back and forth by 170px, twice, every
twenty seconds, for as long as anyone looked at the page.

`cyrus/wwcca-association-page` hit the same thing on the WWCCA page and
fixed it with a full-width flex cell (`lg:flex lg:items-start
lg:justify-end`), which keeps the figure at its own max width every frame
and pins it right without letting the cell resize. The landing page now
uses the same idiom, so there is one answer to this shape rather than two.

**Measured in real Chromium against a production build** (`next build` +
`next start`), sampling every 100ms across a full 20-second loop of the
demo — 259 samples per width. Nothing in this repo's unit suite can see any
of it: happy-dom does no layout and returns zeros from
`getBoundingClientRect`.

| width | | left edge (x) | figure width | y of the section below |
| --- | --- | --- | --- | --- |
| 1500 | before | 750 → 920.1 (**170.1px**) | 373.9 → 544 (**170.1px**) | 5762.5, delta 0 |
| 1500 | after | 778, **delta 0** | 516, **delta 0** | 5762.5, delta 0 |
| 1024 | before | 448 → 618.1 (**170.1px**) | 373.9 → 544 (**170.1px**) | 6374.1, delta 0 |
| 1024 | after | 540, **delta 0** | 452, **delta 0** | 6374.1, delta 0 |
| 375 | before | 16, delta 0 | 343, delta 0 | delta 522 |
| 375 | after | 16, **unchanged** | 343, **unchanged** | delta 522, **unchanged** |

**A second symptom nobody had named: at 1024 the fit-content cell
OVERFLOWED its own grid track.** The track is 452px wide and the cell
reached 544px, so on the widest frame the demo's box crossed **36px** into
the column of words beside it — and `elementFromPoint` sampled down that
strip returned the figure, not the text, so the scene was painting over the
page's own sentence. After the fix the gap between the two columns is a
constant 56px (the `lg:gap-14`) at every width and every frame.

**THE HEIGHT RESERVE THE WWCCA PAGE NEEDS IS NOT NEEDED HERE, AND THAT IS
MEASURED RATHER THAN FORGOTTEN.** The WWCCA fix also added
`lg:min-h-[620px]`, because on that page the demo is the tallest thing in
its row and every loop shoved the savings calculator 192px up and down. The
expectation was that the landing page had the same defect. **It does not.**
The y of the next section held to a delta of **0.0px** over a full loop at
both 1500 and 1024, before this change and after it. The demo's own height
does swing 416px (201.9 → 617.9), but the row never follows it: the left
column — heading, paragraph and AskCanDo's four groups — is the taller of
the two at every `lg` width, so it sets the row height and the demo varies
inside it. A reserve would have bound on nothing. It was not added.

What that costs instead is a margin worth writing down, because it is
thinner than it looks: the left column beats the tallest frame by 165.1px
at 1024 (789 vs 623.9) but by only **7.1px** from 1280 up (625 vs 617.9),
where the section hits its 1088px cap and the numbers stop changing. If
AskCanDo loses an item or the heading loses a line, that margin goes and
the row starts following the frame — so re-measure before assuming this
still holds. The comment at the cell says so with the numbers in it.

Under `lg` there is deliberately no reserve either, the same call the WWCCA
page made: stacked, the tallest frame is 733.8px at 375, and reserving that
would strand up to 522px of empty page under a short frame. The 522px of
movement at 375 is therefore unchanged by design, not overlooked — this
change is `lg:`-only and the 375 column of the table above is identical on
both sides of it.

`window.innerWidth` equalled the device width and `scrollWidth` equalled
`innerWidth` on all 259 samples at every width, before and after: nothing
here widens the page or pans.
