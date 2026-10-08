### The offer page stopped explaining itself and started showing itself (Cyrus)
`cyrus/free-takeoff-landing` (second pass on #674)

The first version of `/wall-takeoff` explained the free drawing-set read in
four card sections — every deliverable with its body and its "check it in ten
seconds" line, then the limits, then how it works, then where it goes — and
put the form after all of it. Roughly four hundred words before the ask. It
was accurate and it was honest and the founder's verdict was that **a sub
should know what this is by LOOKING at the page.** He was right: nobody reads
four hundred words off a link in a text message.

**The page is now a picture.** `components/landing/SheetReadFigure.tsx` puts a
drawing sheet on the left and the list that came off it on the right, with a
line sweeping down the sheet while the rows fill in beside it. That is the
whole offer — we read your set, you get the list back — stated without a
sentence. Above it: one headline and one line. Below it: three outcomes. Then
the ask.

**THE SIMPLIFICATION IS ORDER AND TYPE SIZE, NEVER CONTENT, AND THE CENSUS IS
WHY.** The tempting move was to drop the lists and write a short page in fresh
prose. `takeoff-offer.test.ts` requires this component to map over
DELIVERABLES, WHAT_IT_FEEDS, LIMITS and NEXT_STEPS, and its own message says
what that is for: a promise that can drift between the page and the email is a
promise we did not keep. Fresh prose is exactly that drift — the email would
still promise four things while the page promised three, and nothing would
notice. So every list is still rendered from the one source; they moved below
the ask and got smaller. Nothing on the page restates anything in
`lib/takeoff-offer.ts`, which the duplicate-literal half of that census
enforces independently.

**The ask moved above the detail**, which is the other half of the rebuild. A
reader convinced by the figure no longer scrolls past four hundred words to
act, and a reader not convinced by the figure was never going to be convinced
by the fourth section.

**`OUTCOMES` is new, and every entry has to point at something that exists.**
Three bold lines saying what the read gets him. A benefit is the easiest thing
on a page to overstate, and the failure mode is specific: "we read your
drawings" drifting into "we do your takeoff" one reassuring clause at a time,
with nothing to catch it, because a benefit is not a deliverable and no
`Backing` covers it. So each carries `from` — the id of the DELIVERABLE or
WHAT_IT_FEEDS entry it is the consequence of — and the census resolves every
one. Same discipline as `Backing`, one step further out: those say a
deliverable is produced by code that exists, these say a benefit is produced by
a deliverable we promise. A second guard refuses a numeral in either half,
because there are no customers to quote and an invented figure is the one
claim on this page that could not be checked against anything.

**The motion is the fourth figure on this codebase's public surface and obeys
the same two rules as the other three.** Gated twice and independently —
`useMotionCue` never sets `playing` under reduced motion, and the CSS lives
entirely inside a `prefers-reduced-motion: no-preference` block — so a bug in
either layer still cannot move anything for a reader who asked it not to. And
**at rest it is FINISHED**: the sweep is `opacity: 0` by a base rule above the
media query, every row is present and readable, and a server render, a browser
with JS off and a reduced-motion reader all get the drawing beside the list
that came off it. The claim is made without a frame of animation; the motion
only re-enacts it. Nothing is parked invisible waiting for an observer.

The sheet stage is a fixed height and clips, so the sweep is absolutely
positioned inside it and the rows only animate opacity and a 6px lift —
**nothing changes its own height as it plays and nothing below it moves**,
which is the rule two bugs on the main landing page paid for (one spent 170.1px
sliding a cell's left edge).

**One deliberate break with the house vocabulary, named as such.** `[data-reveal]`
lifts a section as one block with no stagger, and that is right for a section:
one thought arriving. This figure is a process — sheets in, rows out — so the
rows arrive 260ms apart behind a 2.2s sweep. It is the only staggered motion on
either public page, and the reason is that here the order IS the information.

Two regressions the tests caught rather than a reviewer: the rebuild dropped
`DELIVERY.shareable` (what he can do with the read once it lands) and turned
the intake address from a live `mailto` into plain text. The second mattered
most — this page is opened on a phone more often than not, and a tappable
address is the difference between sending the set now and meaning to later.

Three mutations, each red on the test meant to catch it: an outcome naming a
basis that does not exist, a numeral in a benefit, and the page quietly
stopping rendering the outcomes.

**Mobile is written to the rules and NOT seen.** The panels stack below `lg`,
the arrow rotates to point down rather than sideways at a panel now underneath,
and the headline steps `4xl / 5xl / 6xl`. No test in this repo can see layout —
happy-dom returns zeros from `getBoundingClientRect` — and no container here
can reach a browser, so `e2e-public` walking this route at 320 and 375 is the
first real check, and the click-list is the second.
