### Concept G against the web interface guidelines: phones, keyboards, honest buttons (Cyrus)
`cyrus/g-review-fixes`

A guidelines review of the Concept G files found about sixty things; these
are the ones a contractor would hit.

**The pay-app button says where the pay app is.** It read "Review & send to
Turner" on a pay app Turner had already paid or disputed. It now follows the
status (submitted → review & send, paid → "View paid pay app #N", disputed →
"Review dispute", otherwise "View pay app #N"), and "Start pay app #N"
actually opens the form and puts the cursor in it instead of scrolling to a
closed one. A pay app from another year says the year. Check:
`jobPage.render.test.tsx`, mutation-tested.

**Phones see what desktops see.** The when on Needs-you ("overdue 12 days")
and each job stage's status were `hidden sm:` or tucked in a `title`; both
show at every width now. The job header's money wraps instead of running
three seven-digit figures into each other at 375px (measured: 113px of text
in a 101px column). Area waiting-list rows put the status beside the ref,
so a row is 106px, not 134px. Long job names break instead of overflowing.

**Search works like links and talks on phones.** Results are real links
(Cmd/middle-click/long-press open a new tab) and still arrow-key options;
the close control is 44px and says "Close" on a phone; the live region was
inside a footer phones hide, so it never spoke — it now announces counts,
errors and "Nothing found" at every width. "1 result", not "1 results";
group labels point at real ids. Check: `commandPalette.test.tsx`, two
mutations.

**Keyboard and focus.** All pages traps Tab and gives focus back to the
avatar; the avatar menu takes focus, closes when focus leaves, and Esc
returns to the avatar. A skip link is the first Tab stop on every signed-in
page. Check: `shell.test.tsx`, mutation-tested; walked in Chromium.

**Smaller, all measured or tested:** 44px targets on the listed links and
buttons; 16px dashboard search; brand hover is a token (`brand-hover`, held
to the dark-label floor in `theme-contrast.test.ts`); the alert badge uses
the rose tag tokens; dimmed area boxes stay readable (50% opacity measured
2.4–3.5:1, now 85% and ≥4.86:1); `viewport-fit=cover` so the phone tabs'
safe-area padding is real; theme-color matches the canvas; taps lose the
double-tap delay; "2 RFIs late"; a promised date through `formatCalendarDay`
rather than a hand-cut "MM/DD"; chevron motion respects reduced motion;
stage links that leave the job are marked.
