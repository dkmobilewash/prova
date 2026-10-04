### Cards that look like cards: a darker canvas, elevation, and a smaller large title (Diego)
`diego/mobile-visual-pass`

**Phone only. No schema, no migration, no logic, no API.** Tokens and three
surfaces. This is the half of the UI brief #581 and #582 did not do.

**THE HONEST FRAMING FIRST.** #581 restructured the app — five tabs, a job
hub with counts — and did not touch the visual language at all. Diego's
brief had asked for both: *"analyze the uploaded screenshots for colour
contrast, card layouts, typography scale, and use of whitespace."* The app
came back rearranged and looking exactly as it had, which is what he said
when he saw build 8. Nothing was blocking it; the wrong half was done first.

**1. The canvas was ~4% away from the surfaces sitting on it.**
`#f2f2f7` under `#ffffff` is about a 4% step — invisible on a phone, so
nothing read as layered and the 1px outline was doing all the separating by
itself. Canvas is `#e5e7ee` now, roughly an 11% step, and every contrast
floor still clears with room: ink 13.8:1 (floor 7), inkBody 7.4:1 (4.5),
link 5.7:1 (4.5).

**2. Cards are lifted, and the old reasoning is kept rather than deleted.**
The theme said elevation was used *"exactly once in this app… Everything
else stays flat: borders and surface tones do the lifting."* That was a
real choice and it is revised on evidence rather than taste: an outlined
rectangle reads as a BOX, and every reference layout this was reviewed
against uses a white surface floating on grey. `shadow.card` is deliberately
much softer than `shadow.floating` — opacity 0.06 against 0.18 — so a list
of them reads as paper rather than a stack of buttons.

**3. The large title went 34 → 28.** At 34 the greeting and the job name
took the most valuable band on the screen to say the least operational
thing on it.

**`outdoor` MUST NOT GET THE SHADOW, AND THAT IS WHY `depth` EXISTS AS A
TOKEN RATHER THAN A COMMENT.** A soft shadow is the first thing direct
sunlight destroys, so in glare a card is told apart by its border — which is
why `lineCard` there is `#6b6b6b` rather than a hairline. Elevating outdoor
would spend the one cue those users have on decoration none of them can see,
and it is exactly what a later "make the palettes consistent" tidy-up would
do. So each palette declares `depth: "lifted" | "flat"`, one `cardSurface()`
reads it, and `Card`, `GroupedList`, the job-hub tiles and its facts card
all go through that one function.

| mutation | card-depth | theme-contrast |
| --- | --- | --- |
| ctl nothing changed | green | green |
| outdoor made `"lifted"` | **RED** | green |
| a lifted card also gets a border | **RED** | green |
| `GroupedList` hand-rolled again | **RED** | green |
| canvas darkened past the contrast floor | green | **RED** |

The last row is the point of having both: a colour defect is invisible to the
depth contract and a structural one is invisible to contrast. Neither test
could have been written as the other.

**WHAT THIS DELIBERATELY DOES NOT DO.** It does not census every hand-rolled
border in the app. Nine files pair `surface` with `lineCard` and most are
CONTROLS — Chip, Button, Field, the way-home button — which keep their
outlines on purpose, because a control should read as a thing you press
rather than as paper. A blanket rule there would be a false-positive machine,
and a census that cries wolf gets its exception list padded until it means
nothing.

And the yellow is untouched, on Diego's instruction. It is the loudest
remaining difference from the reference layouts — their status chips are
muted pastels — but it is brand, not style.

**NOT PROVED, as ever:** nothing here can measure layout, so whether the
shadow reads at all on a real screen, and whether 28pt titles leave the
screens feeling tight or balanced, are claims a phone has to settle.
