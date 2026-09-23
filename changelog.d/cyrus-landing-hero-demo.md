### The Ask demo leads the landing page's hero, and nothing moves while it plays (Cyrus)
`cyrus/landing-hero-demo`

The assistant animation is now the first thing a visitor sees on the public
landing page — in the hero's right half at desktop, and FIRST on a phone,
above the headline (Cyrus's call). It used to sit six sections down beside
the assistant section's words. The pay-application summary that filled the
hero's right half keeps its own placement under "Getting paid"; the hero's
copy was its second, and two drawings of one panel is not what the hero was
for.

**Measured in real Chromium against a production build** (`next build` +
`next start`), sampling every 100ms across a full loop of the scene — 259
to 260 samples per width, 26 distinct steps, one clock wrap — at 1500,
1280, 1024, 640, 375 and 320, before and after. Nothing in this repo's unit
suite can see any of it: happy-dom does no layout and returns zeros from
`getBoundingClientRect`.

| width | | headline's y | y of the section below the hero | demo x | demo width |
| --- | --- | --- | --- | --- | --- |
| 1500 | before | 112, delta 0 | 1294.5, delta 0 | 778, delta 0 | 516, delta 0 |
| 1500 | after | 112, **delta 0** | 1294.5, **delta 0** | 874, **delta 0** | 420, **delta 0** |
| 1280 | before | 112, delta 0 | 1294.5, delta 0 | 668, delta 0 | 516, delta 0 |
| 1280 | after | 112, **delta 0** | 1294.5, **delta 0** | 764, **delta 0** | 420, **delta 0** |
| 1024 | before | 112, delta 0 | 1356.6, delta 0 | 540, delta 0 | 452, delta 0 |
| 1024 | after | 112, **delta 0** | 1356.6, **delta 0** | 572, **delta 0** | 420, **delta 0** |
| 640 | after | 772, **delta 0** | 1638.3, **delta 0** | 24, **delta 0** | 544, **delta 0** |
| 375 | after | 890, **delta 0** | 1963.2, **delta 0** | 16, **delta 0** | 343.5, **delta 0** |
| 320 | after | 890, **delta 0** | 1963.2, **delta 0** | 16, **delta 0** | 343.5, **delta 0** |

The hero was static before this change — the demo was not in it — so those
zeros in the "before" rows are the bar this had to clear, not a fix. What
this change DID fix is one row below: **the section under the assistant
section moved 14px per loop at 1500, 1280 and 1024, 402px at 640, 522px at
375 and 678px at 320**, because the demo sat there with no height reserve.
All of that is now zero, because the demo is not there any more.

**The one thing that could not be built as asked, and it is a measured
number rather than a preference.** The decision was headline LEFT, demo
RIGHT, in two columns. That needs a headline column, and this headline
cannot have one. Its min-content width — the widest thing in it that cannot
be broken, "subcontractors." — is **824.3px of an 1088px content box** at
1280 and 1500, and **791.3px of 960px** at 1024. Leaving the headline its
room leaves 264px for a gap and a demo, and that is not a demo. The
alternatives were all closed already: the clamp, leading and tracking are
measured type specs the file refuses to trade for layout, and the earlier
attempt at exactly this layout (with a 420px PANEL beside the headline) is
on record as six ragged lines pushing past their own column. So the
headline keeps the full width and the demo takes the right half of the row
underneath it — on the first screen beside the words, under the headline
rather than next to it. On a phone it is first, above the headline, exactly
as asked, and the `<h1>` stays first in the MARKUP so a screen reader meets
the headline before a pause button.

**The height reserve, and the headroom it leaves.** The demo's own height
swings 422px per loop at `lg` (201.9 → 623.9) and 522px at 375 (211.8 →
733.8). Below `lg` it is alone in its row, so without a reserve the
headline and every section under it would jump that far on the front page
of the marketing site. Three tiers, each the tallest frame at that figure
width plus headroom:

| tier | applies | tallest frame | headroom |
| --- | --- | --- | --- |
| `min-h-[750px]` | to 575 | 733.8 (figure 343.5) | 16.2px |
| `min-[576px]:min-h-[620px]` | 576 and up | 603.9 (figure 544) | 16.1px |
| `lg:min-h-[660px]` | 1024 and up | 623.9 (figure 420) | 36.1px |

16px is thin and is written down as thin: one taller frame in
`askDemoScript.ts` and the reserve is short by exactly the difference,
which is a wobble. `min-[576px]` rather than `sm`, because 576 is where the
figure reaches its 34rem cap and stops getting taller — not 640.

**The `lg` tier does not bind, and the first draft of its comment said it
did.** That claim came from a remembered "~578px" for the hero's words
column. Measured, the words column is **691px at 1280 and 1500 and 769px at
1024** — taller than the tallest frame either way, so the column sets the
row and the demo varies inside it, with 67.1px of margin at 1280 and up and
145.1px at 1024. The `lg:` tier is kept as insurance sized above the
tallest frame: cut the paperwork list or shorten the subhead and the row
holds at 660 instead of starting to follow the frame. (The assistant
section the demo came from has the same shape with 7.1px of margin, which
is how thin this gets before anyone notices.)

**The demo's width is constant on every frame** — 420 at `lg`, 544 from
576, 343.5 below — which is #459's fix reused rather than rediscovered:
`lg:flex lg:justify-end` and never `lg:justify-self-end`, whose fit-content
sizing slid this same demo 170.1px sideways every loop on this very page.
`app/page.test.ts` now asserts the banned class is absent.

**Found in passing, NOT caused by this change, and not fixed here: the
landing page scrolls sideways on a 320px screen.** scrollWidth 359 against
an innerWidth of 320 — identical before and after, so it is not the demo's.
Isolated the documented way rather than inferred: hiding the `<h1>` takes
scrollWidth from 359 to 320, and hiding the demo figure changes nothing.
The headline's min-content at its 40px floor is 343.5px, not the 288px the
comment above it claims, so the word needs 343.5 in a 288px box. Fixing it
means touching the clamp, which wants its own change with its own
measurement; the false sentence is corrected in place so the next person
does not stop looking. `expectFitsTheViewport` in the public e2e suite
would catch this, but `ci.yml` runs test, lint, typecheck and build — not
that suite — so nothing automatic has been asking. 360 and 375 are clean.

**What the demo left behind.** The assistant section was a two-column grid
with the demo on the right; it is now a single `max-w-3xl` column of words
and AskCanDo's list, not a grid with an empty half — which is the exact
defect this page was rebuilt to remove from the hero. It keeps its heading
and its place in the running order (`SECTIONS_IN_ORDER`), it keeps the
sentence that holds the assistant honest, and the page still has **one**
list: AskCanDo appears there and nowhere else, and the demo in the hero
carries no list of its own.

`app/page.test.ts` goes from 20 tests to 21, and nothing was relaxed. The
hero guard now asserts the demo is IN the hero (it was "a panel is in the
hero"), that the hero has no panel wrapper left, and that the pay
application is still drawn below the hero — so the hero losing its copy
cannot read as the panel leaving the page. The placement count came down
from five sites to four with the reason written beside the literal. A new
guard pins the cell's classes: phone-first ordering, the `<h1>` still first
in the markup and spanning both columns, `lg:justify-end` with no
`justify-self`, and a reserve at both phone widths and `lg`. Mutation-tested
— restoring `justify-self-end`, dropping the reserve, dropping
`order-first`, and taking the demo out of the hero each turn it red, and
the control run is green.

`window.innerWidth` equalled the device width at every width except 320
(above), and `scrollWidth` equalled `innerWidth` at 1500, 1280, 1024, 640
and 375 on all 259-260 samples, before and after.
