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
