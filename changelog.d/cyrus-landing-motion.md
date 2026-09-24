### Two animations on the landing page, and nothing on it moves while they play (Cyrus)
`cyrus/landing-motion`

Cyrus picked two motions off a preview sheet: a submittal coming back
STAMPED, and money counting up to its real value with a bar filling under
it. Both are on the public page now, each one standing next to a claim the
page already makes.

**The stamp is beside "Protecting yourself when it goes wrong"** — the one
ranked section that had no drawing, for a reason recorded in the file: the
panel set is four documents and a submittal register is not one of them.
This is not a fifth panel; it is an animated figure, like the Ask demo, so
the four-panel census is untouched. It earns its keep against all three of
that section's cards at once: two revisions kept and neither renumbered,
a state that is worked out rather than stored, dates that were entered.
Every word on it is DERIVED — the stamp is `outcomeLabel(latest.outcome)`
upper-cased, the chip is `stateLabel(submittalState(revisions))`, the days
open are `daysBetween`, the dates are `formatCalendarDay`. Rename the
outcome in `components/submittalLabels.ts` and the stamp changes with it.

**The count-up is under the bullet that claims it in "Getting paid"** —
"Retainage held and released per job" — in the words column, which is the
shorter of the two there, rather than as a second drawing in the column
that already holds a G702/G703. Its figures run through
`calculateRetainageSummary`, the same function the Retainage tab calls, and
the labels are the product's own ("Outstanding balance", "Total withheld",
"Total released", "Withheld and not yet released", and the dashboard
retainage card's teal). **The two drawings in that section agree**: the
snapshots sum to $36,970.50, which is exactly the "Retainage to date" the
pay application panel computes for the same job, less $12,000.00 released
gives the $24,970.50 the figure counts to. `RetainageCountUp.test.ts`
renders BOTH components and compares them, so if either side drifts the
build fails with "the two drawings of this job have drifted, and a reader
who adds up the page now gets two answers".

Neither is in the hero. The Ask demo took that spot three days ago (#475)
and a second animation competing with it would be worse than none.

**Measured in real Chromium against a production build** (`next build` +
`next start`), sampling every 100ms across a full cycle of each figure —
53 samples per figure per width, through play → scroll away → replay,
which is when a height change would happen — at 1500, 1280, 1024, 640, 375
and 320. Nothing in this repo's unit suite can see any of it: happy-dom
does no layout and returns zeros from `getBoundingClientRect`.

| width | | stamp height | y below the stamp | count-up height | y below the count-up |
| --- | --- | --- | --- | --- | --- |
| 1500 | before | — | 5940, delta 0 | — | 2849, delta 0 |
| 1500 | after | 421.8, **delta 0** | 6380, **delta 0** | 261.8, **delta 0** | 3056, **delta 0** |
| 1280 | before | — | 5940, delta 0 | — | 2849, delta 0 |
| 1280 | after | 421.8, **delta 0** | 6380, **delta 0** | 261.8, **delta 0** | 3056, **delta 0** |
| 1024 | before | — | 6387, delta 0 | — | 3026, delta 0 |
| 1024 | after | 421.8, **delta 0** | 6814, **delta 0** | 261.8, **delta 0** | 3218, **delta 0** |
| 640 | before | — | 8055, delta 0 | — | 3662, delta 0 |
| 640 | after | 421.8, **delta 0** | 8819, **delta 0** | 261.8, **delta 0** | 3964, **delta 0** |
| 375 | before | — | 10199, delta 0 | — | 4455, delta 0 |
| 375 | after | 477.8, **delta 0** | 11045, **delta 0** | 287.6, **delta 0** | 4783, **delta 0** |
| 320 | before | — | 11421, delta 0 | — | 4790, delta 0 |
| 320 | after | 519.6, **delta 0** | 12309, **delta 0** | 287.6, **delta 0** | 5118, **delta 0** |

("y below" is `offsetTop` — LAYOUT position. The document rect of the
section BELOW the stamp reads a 14px swing, and that is the page's own
reveal motion translating a not-yet-seen section, not the page moving:
sampled, the element is `data-reveal="pending"` with
`matrix(1,0,0,1,0,14)` easing to `none`. Sampling the first sighting
without letting the reveal settle reports that 14px as this change's, which
is what the first run of the measurement did.)

**What the discipline is worth, measured rather than asserted.** The same
two figures, built the ordinary way — the animated parts mounted when they
play, no height reserve — were measured on the same build:

| | figure height | y below it | page height |
| --- | --- | --- | --- |
| stamp, mounted-when-playing | 389.8 → 469.8, **80px every cycle** | **80px** | **80px** |
| count-up, mounted-when-playing | 237.8 → 261.8, **24px every cycle** | 12-24px | 24px |

That is #475's defect again (402px at 640, 678px at 320) in miniature. The
shipped versions cannot do it: the stamp is absolutely positioned inside a
fixed-height, clipped stage and animates `transform`/`opacity` only; the
count-up's digits are `tabular-nums whitespace-nowrap`, so a growing string
changes the element's WIDTH and nothing else, and the bar's fill grows by
`transform: scaleX`, which is not layout. Both chips are in normal flow at
rest with only their opacity animating.

**The reserves, and the headroom, which is thin.** Each tier is the tallest
the figure gets at the NARROWEST width in its range, because the height only
falls as the column widens.

| stamp | applies | tallest | headroom |
| --- | --- | --- | --- |
| `min-h-[528px]` | to 374 | 519.6 (figure 288) | 8.4 |
| `min-[375px]:min-h-[486px]` | 375 to 479 | 477.8 (figure 343.5) | 8.2 |
| `min-[480px]:min-h-[446px]` | 480 to 575 | 437.8 (figure 448) | 8.2 |
| `min-[576px]:min-h-[430px]` | 576 and up | 421.8 (figure 544/516/452) | 8.2 |

| count-up | applies | tallest | headroom |
| --- | --- | --- | --- |
| `min-h-[296px]` | to 399 | 287.6 | 8.4 |
| `min-[400px]:min-h-[262px]` | 400 to 639 | 253.8 | 8.2 |
| `sm:min-h-[270px]` | 640 and up | 261.8 | 8.2 |

~8px is thin and is written down as thin in the file: a third revision line
on the stamp, or one more line in either caption, and the reserve is short
by exactly the difference. Every reserve BINDS — the cell measures exactly
its `min-height` at all six widths, which also takes out the sub-pixel
jitter the stamp's own box has at 600 and 639 (421.7/421.8 from the scroll
offset). The stamp's reserve is load-bearing at every width (it is the
taller cell in its row, so the three evidence cards sit on it); the
count-up's does not bind at `lg`, where the pay application sets the row.

**Reduced motion gets the finished record, not a frozen first frame.**
Checked in real Chromium with `prefers-reduced-motion: reduce`: the stamp
is on the sheet at its angle at full opacity, both chips are there, the
figure reads $24,970.50 and the bar is full — one distinct value across the
whole run, `data-motion-play` never leaves `idle`, and `getAnimations()`
returns 0 on the stamp, the chips and the fill. It is gated twice and
independently, the shape `Reveal.tsx` and `FactTicker.tsx` already hold:
`useMotionCue` never says "playing" under reduced motion, and every
animation rule lives inside globals.css's single
`prefers-reduced-motion: no-preference` block. With motion allowed, the
same probe sees the stamp pass through seven distinct transform/opacity
states and the money through thirteen values — so the check can tell
"played" from "never ran", which a still page would otherwise pass.

**Nothing on either figure is a percentage, and that is not squeamishness.**
`app/page.test.ts` runs an invented-statistic pattern (`\d+%` among others)
over this page's PROSE, and these are prose — they are not
`data-landing-panel` placements, so nothing strips them. A class like
`w-[63%]` or an inline `style="width:68%"` is markup like any other and
would trip that guard exactly as a sentence would. So the bar is two flex
children whose `flex-grow` values ARE the two dollar amounts — guard-safe,
and one fewer number to keep in step. For the same reason both captions say
"Example." in the Ask demo's words rather than PanelFrame's "Figures are
illustrative": that string is counted one-per-panel-placement by a guard,
and a fifth copy with no fifth placement would have turned it red. No guard
was edited or weakened.

**Guards added, and mutation-tested.** `app/page.test.ts` goes from 21
tests to 25: each figure's placement (once, below the hero, inside the
right section, above the cards for the stamp), the reserve at every tier,
the `justify-self` ban #459 left behind, and that both figures render
FINISHED at rest. `SubmittalStamp.test.ts`, `RetainageCountUp.test.ts` and
`app/globals.motion.test.ts` are new. Seven mutations, each turning the
intended guard red and the control green: dropping either base reserve
("expected 'min-w-0 min-[375px]:min-h-[486px]…' to match
/(^|\s)min-h-\[\d+px\]/"), restoring `justify-self-end` ("expected … not to
contain 'justify-self'"), moving the stamp's animation outside the
reduced-motion block ("no landing-motion animation rules found at all:
expected 2 to be 3"), renaming either CSS class hook, and changing one
retainage snapshot so the two drawings disagree.

**One of those mutations found a hole in the guard itself**, which is the
part worth keeping. Renaming `landing-stamp__mark` to
`landing-stamp__marker` — which breaks the animation outright — left the
test GREEN, because the assertion was
`toMatch(/class="[^"]*landing-stamp__mark/)` and the old name is a PREFIX of
the new one. Both component tests now split the class attribute and compare
it as a list, and the mutation goes red naming the class it found.

**Found in passing, not this change's and not fixed here:** the page still
scrolls sideways by 39px at 320 (scrollWidth 359 against innerWidth 320),
identical before and after, from the `<h1>`'s min-content width — recorded
in #475 and unchanged. Every other width measured `scrollWidth ===
innerWidth` on all 53 samples, before and after.
