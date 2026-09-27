### The Ask animation is whole on the first screen, and the phone reserve stops being 140px short (Cyrus)
`cyrus/landing-hero-fold`

Cyrus, filming a launch video at 1280, looking at cstream.ai: *"can we get
the animation to come up more at the top so they dont have to scroll down
to see the whole thing"*. He was right, and it was worse than it looked —
the Ask demo is the most persuasive thing on the page and a prospect had to
scroll to watch it finish.

**Measured before arguing**, in real Chromium against a production build,
sampled every 100ms across a full 26-step loop of the scene so that the
number is the TALLEST frame rather than whichever one was on screen:

    header 40 + hero py-10 + headline 395.5 + gap-y-10 -> demo top 547.5
    tallest frame 623.9                                -> demo bottom 1171.4
    fold at 1280x900   271.4px of the panel below it
    fold at 1280x800   371.4px below it

**That budget is what decided the fix, and it ruled out every cheaper
one.** To be whole at 900 the demo must start by y=276.1, and at 800 by
y=176.1. The header and the hero's own padding are already 112px. So
nothing may sit above the demo — no headline at any size, no smaller gap,
no trimmed padding — and the demo has to be in the FIRST grid row. Trimming
`py-10` and `gap-y-10` to nothing would have bought 80 of the 271px needed.

So from `xl` (1280) the demo takes column 2 and spans BOTH rows, and the
headline takes column 1 of row 1 — the layout LandingPage.tsx's own comment
says could not be built. That comment is not wrong about why: at 96px the
headline's min-content really is 824.3px and the left column really is
612px. What it was missing is that the stacked alternative loses the fold,
which nobody had measured until now.

**The price is the headline, and it is a real one.** `xl:text-[4rem]` (64px
against 96px), because 612px is a width 96px cannot be set in. Swept in the
browser at 1280, line count in that column: 96/80/76px overflow it outright
at six lines, 72/70/68px give five, 64px gives four with the widest line at
588.7 of 612, 48px gives three. 64px is the largest size that keeps the
four-line shape the full-width headline already had. **The clamp itself is
untouched** — every width below 1280 renders exactly what it rendered
before, 9vw and the 96px top end included.

    1280x900   demo bottom 1171.4 -> 735.9    164.1px ABOVE the fold
    1280x800   demo bottom 1171.4 -> 735.9     64.1px ABOVE the fold
    1440x900   the same
    1024, 375, 320  unchanged, to the pixel

**Two things the file said that the measurement contradicted**, both
corrected in place rather than left standing. The headline does not "keep
the full 1088px and its three lines": `max-w-4xl` caps it at 896 and at
1280 it is four lines, 395.5px tall. The 1088 is the GRID's width — the
right number for deciding what a column can hold, carried by mistake into a
sentence about a different element.

**And the base height reserve had gone 139.8px short on the smallest
phone**, which the same note predicted in writing: *"IF THAT OVERFLOW IS
EVER FIXED, THE FIGURE DROPS BACK TO 288 WIDE AND THIS BASE TIER IS 140px
SHORT. Re-measure with it."* The 320px overflow WAS fixed (the headline's
floor is 2rem now), so the figure is 288 wide and 889.8 tall against a 750
reserve — the demo cell's own height swung 750 -> 889.8 across the loop,
which is the headline and every section under it jumping that far while the
one animation this page is built around plays. Re-measured per width and
tiered: 890 base, 790 from 336, 770 from 360, 750 from 375. A narrower box
wraps taller monotonically, so each tier only needed measuring at its own
left edge.

**The check.** Cell height is now CONSTANT across the whole loop at 320,
336, 344, 360 and 375 (it was 750->889.8, 750->785.8, 750->785.8,
750->769.8 before), with `scrollWidth === innerWidth` at every one of them,
so nothing pans sideways. `app/page.test.ts` pins the new arrangement —
`xl:col-start-2` + `xl:row-start-1`/`xl:row-end-3` on the cell,
`xl:col-end-2` + `xl:row-start-1` on the headline, an `xl:` size on the
headline at all, and a base reserve of at least 800px. Four mutations, four
reds, each naming the class it removed. One of those mutations was green on
its first run and the green was VACUOUS — the literal `xl:text-[4rem]`
appears in the file's own comment as well as in the class, so the edit
never applied. Re-run against the class alone, it is red.

**What could not be checked from here, stated rather than glossed.** This
page loads no webfont — `document.fonts.size` is 0 and the headline
computes to `ui-sans-serif, system-ui, sans-serif` — so every width above is
this container's font, not the SF Pro a Mac renders. The error runs the safe
way (the fallback here is a wide face; SF and Segoe are narrower, so a real
visitor gets more slack than the 62.5px measured, not less), but the line
count is not guaranteed: a narrower face may set the headline in three lines
rather than four. Nothing breaks if it does — the demo spans both rows and is
anchored to the top of the first, so it does not move when the headline does.

---

**Then Cyrus asked for two more things on the same branch: a bigger Ask
panel, and a typeface.** They turned out to be the same change.

**The panel is 544px wide at `xl`, up from 420.** 544 is not a round
number: it is 34rem, the figure's own `max-w-[34rem]` cap. A column wider
than that does not widen the panel — it parks the panel at 544 with dead
space beside it, because the cell pins the figure right. So 544 is the
largest column that is ALL panel.

**Widening BOUGHT fold margin instead of spending it**, which is the
opposite of the risk. The demo's cards reflow, and a wider panel wraps
shorter. Sampled across the full 26-step loop at 1280, tallest frame by
column width: 420 → 623.9, 460 → 623.9, 500 → 617.9, 520 → 617.9,
544 → **603.9**. So the largest panel is also the safest one, and the
answer to "what is the biggest panel that still clears an 800 fold" is
"the biggest panel there is".

**THE PAGE HAD NO TYPEFACE AT ALL, AND THAT IS THE WHOLE ARGUMENT.**
Nothing in `globals.css`, `tailwind.config.ts` or `layout.tsx` set a
family. Measured, not assumed: `document.fonts.size` was 0 and no font
file was requested. Every heading rendered in `ui-sans-serif, system-ui,
sans-serif` — SF Pro on a Mac, Segoe UI on Windows, Roboto on Android. The
page had no identity and looked different on every machine, and every
width this repo has ever measured for it was a measurement of whatever the
measuring machine happened to have. That is why the first half of this
entry had to end with a caveat about its own numbers.

**No psychology claim is being made and none should be.** The evidence for
"serifs read as trustworthy" compares competent faces against Comic Sans;
it says nothing about choosing between two competent ones. The two reasons
here are both measurable: one appearance everywhere, and a condensed face
fits materially more per line.

**That second reason is what made the bigger panel possible.** Min-content
of "subcontractors." — the widest unbreakable word, and the thing that
decides how narrow its column can be — at 64px, in real Chromium:

    system fallback   549.5      Archivo           449.9
    Barlow Condensed  342.0      Chivo             484.7
    Archivo Narrow    364.5      Roboto Condensed  383.2

In the hero's left column at the widened panel (488px), the largest size
that still sets the headline in four lines:

    Barlow Condensed  84px   <- chosen      Archivo          64px
    Archivo Narrow    72px                  Chivo            none fits
    Roboto Condensed  72px                  SYSTEM FALLBACK  none fits

**The last row is the finding.** The stack this page used to render in
does not fit the widened column at any size down to 56px. The panel could
not have been widened this far without changing the face. Barlow Condensed
over Archivo Narrow on the numbers — 84px against 72px in the same column
— and it reads like the signage this trade is surrounded by. Roboto
Condensed tied Archivo Narrow and is the Android system font, so it is the
one condensed face that would look like no choice had been made.

So the headline went UP from the 64px this branch shipped an hour earlier,
in a column 124px NARROWER. Headings only; body text stays on the system
stack, because a second family is a second download.

**`next/font/local`, not `next/font/google`, and the reason is a failed
build rather than a preference.** The Google loader fetches at BUILD time —
a third-party dependency on every build in CI and on Vercel, for a 22KB
file that never changes, where a failure to reach it fails the build
rather than degrading it. It also could not be measured from an agent
container at all: Node's fetch does not use the egress proxy, so the build
died on "Failed to fetch `Barlow Condensed` from Google Fonts" and there
was no page to put a browser in front of. A face chosen by measurement has
to be measurable. The file and its OFL licence are in `app/fonts/`.

    viewport     before this branch   after #532's fold fix   now
    1280x900     271.4 BELOW fold     164.1 above             184.1 above
    1280x800     371.4 BELOW          64.1 above               84.1 above
    1280x720     391.4 BELOW          15.9 BELOW                4.1 above
    1366x768     403.4 BELOW          32.1 above               52.1 above
    1920x1080    91.4 BELOW           344.1 above             364.1 above
    1024x768     387.5 BELOW          387.5 BELOW             292.6 BELOW
    375x812      21.8 BELOW           21.8 BELOW               21.8 BELOW
    320x568      421.8 BELOW          421.8 BELOW             421.8 BELOW

**The checks.** The measuring harness now REFUSES to report a number unless
`document.fonts` says the face is loaded — without that control it measures
the fallback and calls it the result, which is the exact mistake the
webfont exists to end. Phone geometry is unchanged to the pixel and the
cell height is still constant across the loop at 320, 336, 344, 360 and
375, with `scrollWidth === innerWidth` at every one. `displayFontWiring.
test.ts` holds the five-link chain that delivers the face — file, `src`,
the variable, the `<html>` mount, the Tailwind family, a component using it
— because every link but the last fails SILENTLY back to the system stack,
which is what the page did before and so looks like nothing is wrong. It
strips comments before reading structure, since both files discuss
`font-headline` in their own notes. Five mutations, five reds, plus two on
the widened column.

**What is worse, and is recorded rather than hidden.** The empty background
to the right of the paperwork list, below the figure, grew from 370.7px to
**551.2px** — a narrower left column makes the words taller (769 against
691) while a wider panel makes the figure shorter (603.9 against 623.9).
It is all below the fold. The fix is a third structural change (the
paperwork list taking the right column under the demo at `xl`) and belongs
in its own pass rather than folded into a font change.
