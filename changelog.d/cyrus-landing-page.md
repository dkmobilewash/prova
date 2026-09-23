### The public landing page stopped being a headline and two buttons (Cyrus)
`cyrus/landing-page`

The founder opened app.cstream.ai on his phone and described it as "just a
blank page that says sign up or log in" that "definitely needs to look way
more professional." He was right — `apps/web/app/page.tsx` was one `<h1>`,
one line of tagline and two buttons, and it is the first thing anyone sees
who types the domain or is handed a bare link, days before a pilot with
real contractors.

Rebuilt using `/pilot` as the quality bar (not touched, not copied): a
headline that says what the product is and who it is for in one line, the
five trades it is built for named explicitly (framing & drywall, plaster,
EIFS, ceilings, fireproofing — the list CLAUDE.md itself uses), six concrete
capability cards, and an honest "C Stream is new" section instead of any
invented customer count or testimonial. No gradient hero, no stock photos,
no SaaS-startup abstraction — plain, specific, dark-theme, phone-first,
built entirely from existing design tokens (`ink`/`ink-body`/`surface`/
`line-card`/`brand`) and the existing wordmark.

Every capability claim carries the same receipt discipline `/pilot` uses —
a comment naming the file that actually does it (`lib/certified-payroll.ts`,
`lib/apprentice-ratio.ts`, `lib/pay-application.ts`, ARCHITECTURE.md's
unified `Job`/`JobLineItem` object, and so on).

**The one behavior that had to survive the rewrite: a signed-in visitor is
still redirected to `/dashboard`, never seeing the marketing page.**
Preserved exactly (`auth()` from `@clerk/nextjs/server`, `redirect()` from
`next/navigation`), and mutation-tested both directions in
`app/page.test.ts` — removing the redirect line is caught (the signed-in
test fails), and inverting the condition to redirect when signed OUT is
also caught (the signed-out test fails). 2 mutants requested, 2 caught.

The visitor-facing markup moved out of `app/page.tsx` into
`components/LandingPage.tsx` — not a stylistic choice, a build requirement.
Next's page-file type checking rejects any named export from a page module
besides the ones it recognises (`metadata`, `generateMetadata`, the
default), so a `LandingPage` export sitting beside `HomePage` typechecks
clean and fails only at `next build`: "LandingPage is not a valid Page
export field." `app/page.tsx` now exports only `metadata` and the default
guard; the static content lives where it can be rendered directly with no
Clerk mock and no request scope, the same proof `/pilot`'s own test uses.

**Second round, same session: Cyrus asked for a real step up in
production value — bigger, considered rather than plain, the six
capabilities on a "scroll wheel," more motion, ideally real product
screenshots.** Content and claims unchanged throughout; this is entirely
about presentation. Built against measured numbers from comparable pages
(Linear, Gusto, Siteline, Rippling) rather than picked by eye:

- **Scale.** Headline is now fluid, `clamp(3rem, 9vw, 6rem)` — 48px on a
  phone (Gusto's own phone floor, the closest buyer analogue: a
  non-technical SMB owner), ~96px at desktop, tightened leading
  (`1.03`) and slightly negative tracking (`-0.02em`) so bigger reads as
  designed rather than merely large. One vertical rhythm between every
  section (`mt-16 sm:mt-24 lg:mt-[120px]`), landing on Rippling's
  measured 120px at desktop, instead of an ad-hoc value per section.
- **Section order** now matches what every comparable page does: hero,
  then proof (the honest "C Stream is new" — moved up from the footer,
  which is where it sat before), then a problem/contrast section, the six
  capabilities, objection handling, a closing CTA, then the footer. The
  primary CTA repeats three times — nav, hero, closing section — matching
  every page researched (none used it only once).
- **A new problem/contrast section**, "The old way, and the C Stream
  way" — five old-way pains (qualitative, no invented statistics) against
  five C Stream capabilities, each carrying the same code receipt as
  `CapabilitiesSection.tsx`. Argued as the single most defensible section
  available: a GC-first platform cannot honestly run this argument
  against its own buyer.
- **The six capabilities** are now presented two ways depending on
  viewport — same data (`CapabilitiesSection.tsx`'s exported
  `CAPABILITIES`), the layout switches. Below `sm`: a horizontal
  snap-scroll rail, cards at 85vw so the next one peeks (matching
  Linear's own measured phone layout, 328px cards in 390px, ~84vw) — no
  arrows, no dot indicators, the peek is the whole affordance. `sm` and
  up: a tab switcher, confirmed against three comparable pages that none
  run a rail at desktop. The switcher is native `<details name="capability">`
  — the same `name` makes the browser treat six panels as
  mutually-exclusive, a real HTML feature (Chrome 120+, Safari 17.2+,
  Firefox 125+), not a JS cross-fade — chosen because every panel then
  stays fully readable with **zero motion involved in switching at all**,
  which is a stronger reduced-motion guarantee than a cross-fade could
  give. Verified by hand in the running app at both 375px and 1440px:
  swiping/snap-scrolling and the exclusive accordion both work.
- **Motion**: two shared easing tokens as CSS custom properties in
  `globals.css` (`--ease-landing`, `--ease-landing-snap`, `--speed-fast`,
  `--speed-slow`) rather than an ad-hoc curve per component. Only
  `opacity`/`transform` ever animate. `components/Reveal.tsx` reveals
  below-the-fold sections as they scroll into view — the hero is never
  wrapped in it, since nothing above the fold should fade in on load.
  Reduced-motion is asserted independently at the JS layer
  (`Reveal.test.ts`: the observer is never even created) and the CSS
  layer (`app/globals.reveal.test.ts`: the hidden/transition rules live
  entirely inside `@media (prefers-reduced-motion: no-preference)`), plus
  a 4s safety timer so a stuck observer can't strand content hidden.
  5 mutations across both layers, 5 caught.
- **A real gap found by testing in the browser, not assumed:** a
  focused, `tabindex=0`, horizontally-overflowing `<div>` does **not**
  scroll on ArrowLeft/ArrowRight in real Chromium — the "native
  keyboard-scrolls-a-focused-region" behavior some authoring guides
  describe turned out not to apply here. Confirmed with a real Tab
  traversal to the rail and real key presses, not a mock. Fixed with a
  small client component, `components/CapabilitiesRail.tsx` — a
  key handler that moves the rail one card at a time, `behavior: "auto"`
  instead of `"smooth"` under reduced motion. Genuinely optional: with no
  JS, the div underneath is exactly the same overflow-x/scroll-snap
  container it always was, still focusable, still fully readable, still
  scrollable by touch or trackpad. 1 mutation (removing the
  reduced-motion branch), caught.
- **Real product screenshots were asked for, twice, and are deliberately
  not in this PR.** They need a seeded database
  (`packages/db/scripts/seed-demo.mjs`) and a signed-in session to reach
  the pages worth showing (a job's tabs, WH-347 certified payroll, the
  Money Rail, a pay application). This environment has neither a local
  Postgres (no docker/postgres/brew on `PATH`, checked) nor this repo's
  real Neon/Clerk credentials, which the agent-DB-safety rule says not to
  hand to a worktree. Rather than substitute an illustration, that
  section is simply absent — see the PR description for the exact recipe
  to add it.

All CSS/JS built from the platform — no new dependencies, no animation
library. Existing dark/gold tokens only; no new colours. Full suite (355
files / 5793 tests), typecheck, lint and build all green; `./scripts/preflight.sh`
passed with no pending migrations.

**Fourth round: "it still looks really empty."** The founder's judgement,
and the measurement agreed with him rather than with the page. Measured in
a real browser at 1440x900 before this pass: **3391px tall, 3.77 screens,
353 words.** Comparable pages researched for the same buyer run 9-11
screens. The most visible symptom was that at desktop the hero was text on
the left and the entire right half was empty — the exact spot where the two
closest comparables put a product video and an app screenshot.

So this round adds CONTENT, not whitespace or bigger gaps. Nothing about
the measured craft specs from round two changed: same headline clamp, same
1.03 leading and -0.02em tracking, same single vertical rhythm, same two
easing tokens, same reduced-motion guarantees at both layers.

- **Five full sections replace the capability rail as the primary
  presentation**, one each for the things that actually cost a union
  specialty-trade sub money, in that order: getting paid, certified
  payroll, apprentice ratios, whether the job is making money, protecting
  yourself. Each is a heading, a paragraph in trade language, three
  concrete specifics, and — for four of the five — a rendered panel of the
  real document, alternating left and right so they do not read as one
  column.
- **The section order is the argument, and two moves in it are
  load-bearing.** The old-way/new-way contrast moved UP to second: it
  states the problem in the reader's own vocabulary (WH-347, AIA forms,
  retainage, RFIs, submittals) and earns the rest of the page. "C Stream is
  new" moved DOWN from second to immediately before the ask — it is a
  DISCLOSURE, not proof, and in second position it was an apology to a
  reader who had not yet been given a reason to care. Every word of its
  substance is kept, and a second paragraph was added saying why there are
  no logos or testimonials. `app/page.test.ts` now asserts all eleven
  sections in order, strictly increasing, with the two moved ones named in
  the comment so a later "tidy" cannot undo them silently.
- **The rail/tabs component was kept and repurposed rather than deleted.**
  The five capabilities it used to carry now have sections of their own, so
  repeating them would have been the same words twice. It is now
  "Everything else it does" — eight things that did not earn a section but
  are real: fringe remittance, change orders, phase codes, cash flow, lien
  deadlines, backcharges, OSHA case numbers, the offline phone. Same
  component, same phone rail, same `<details name>` desktop switcher; only
  the data moved, and every count in `CapabilitiesSection.test.ts` already
  derived from `CAPABILITIES.length`, so it followed with no edit.
- **A stale number was found while doing it, of exactly the kind CLAUDE.md
  deletes on sight.** The rail's accessible name was the string "What C
  Stream does — six capabilities", hardcoded inside
  `CapabilitiesRail.tsx` — a count sitting next to a list that file cannot
  see. The list is eight long now. `label` is a REQUIRED prop with no
  default, the caller derives it from `CAPABILITIES.length`, and the test
  asserts the derived number rather than a literal of its own. Mutation:
  restoring the old hardcoded string fails the test naming the mismatch.
  1 requested, 1 caught.
- **One claim the brief asked for was refused, because the code does not do
  it.** The panel set was specified as including "estimated vs actual
  labor HOURS on a takeoff line". It does not exist: `JobLineItem.laborHours`
  is an estimate, `lib/wip.ts` compares estimated against actual in DOLLARS
  per line (Contract / Budget / Current est. / Actual / % complete /
  Earned), actual hours surface only as the unpriced-hours coverage caveat
  on `jobWip.laborHourCoverage`, and the only thing in the repo labelled
  "variance" is catalog UNIT COST. The job-cost section claims dollars, and
  `LandingPage.tsx`'s header records the finding so the copy does not get
  "fixed" back into a false claim later.

The panels are **not screenshots and are never called one** — they are the
product's own column headers, row labels and status strings re-rendered as
markup with illustrative figures. `app/page.test.ts` asserts the page never
uses the words "screenshot", "actual customer" or "real customer data", and
counts the placements against a literal so a selector that matches nothing
fails loudly instead of passing an empty set.

**One guard was narrowed and then put back wider, and the round trip is
the part worth keeping.** When the rendered panels landed, the page-wide
"never invent a statistic" assertion started failing — on a G703's real
`%` column and on an apprentice ratio's real hour counts. The first fix
scoped it to the old-way/new-way block it had always been named for,
which was defensible and still wrong: it silently stopped checking nine
other sections of marketing copy, on a page whose entire credibility is
that it contains no made-up numbers. The contrast block was never the
only place a fabricated statistic could appear; it was just the only
place that existed when the test was written.

The right cut is by KIND, not by section. A drawn document may carry real
percentages — it IS the document, and it says on its face that the
figures are illustrative. The prose around it may not. So `stripPanels`
removes every `data-landing-panel` wrapper and the pattern runs over what
is left, depth-counted rather than regex-matched (a non-greedy
`.*?</div>` cuts at the first inner close, leaves most of a G703 behind,
and looks exactly like it worked). Both failure modes of a deriving check
are asserted before the pattern runs: every wrapper gone, more than 3000
characters actually removed, and prose from the first, seventh and last
sections still present — so a stripper that matches nothing and one that
eats the document both fail loudly instead of passing vacuously. The
narrow contrast assertion is kept beside it, since it also pins the ten
contrast lines by name. 3 mutants requested, 3 caught: a fake "37%
faster" in the closing CTA turns the page-wide guard red while the
contrast guard stays green (which is the proof they are not the same
check), and both stripper failures are caught by their own assertion.

The general form, for the next guard here: when new content legitimately
trips an old assertion, ask whether the assertion's SUBJECT changed
before narrowing its SCOPE. Narrowing is the cheap move and it is how
coverage disappears without anyone deciding to drop it.

**Then the fact ticker (fifth round).** The founder had now called the
page empty twice, the second time after it went from 3.8 to 8.4 screens,
and asked for "a spinning wheel of like almost kind of fun facts about why
the software is good just to make it look more high tech and fuller". He
wanted motion and density; the page had length and no motion. So under the
hero there is now a continuously moving band of fourteen short statements
about how the product is built — `components/landing/FactTicker.tsx`.

"Fun facts about why the software is good" is exactly where marketing
fiction creeps in, so the list is held to rules stricter than the page's
own, and the mechanical half is enforced rather than remembered
(`FactTicker.test.ts`): no numeral at all (a fact that needs a digit is on
its way to being a statistic — "WH-347" is the one allowed form name), no
performance or comparison vocabulary, no count of anything, eight to
fourteen entries, each under 110 characters, each carrying the file it was
verified in. The page-wide invented-statistic guard ALSO runs over it — it
is prose, not a `data-landing-panel`, and it was deliberately not added to
the strip list. Every line is a statement about what the code does today,
read before it was written: counters that only count up
(`lib/actions/rfis.ts`), a WH-347 that names its missing field
(`lib/wh347.ts`), a pay-app line that refuses to bill past its scheduled
value (`lib/pay-application.ts`), overdue derived not stored
(`components/rfiLabels.ts`), a sent RFI closed never deleted
(`deleteRfi`), the phone's outbox (`apps/mobile/lib/outbox.ts`), a signed
day's locked hours (`lib/actions/labor.ts`), two permissions between "fixed"
and "verified" on a punch item (`lib/permissions.ts`), photos keeping
capture time and taker apart from upload time (`media.prisma`), the
assistant proposing and only a person confirming (`lib/actions/ask.ts`),
retainage snapshots never rewritten (`lib/retainage.ts`).

Two candidates were verified and DISCARDED because the code disagreed with
the folklore: "money is held in whole cents" — it is not, every money
column is `Decimal(12,2)` with only the payroll register in integer cents,
so the line says "to the exact cent, never floating point" instead; and
"a punch item is verified by someone other than who fixed it" — the code
enforces a different PERMISSION, not a different person, so the line says
that.

The build is a marquee, not a carousel: two copies of the list, the track
translating by exactly half its own width, each copy carrying a trailing
pad equal to its item gap so the wrap is seamless; the second copy is
`aria-hidden` so a screen reader gets the list once. `transform` only, no
JS, no dependency, existing tokens only. Hover and keyboard focus pause it
(the region is focusable, with a brand-yellow ring). AT REST IT IS A LIST:
the default CSS, with no media query at all, draws a wrapped, fully
readable list with the clone hidden; only inside the existing
`prefers-reduced-motion: no-preference` block does it become one moving
row — so a reader who asked for less motion gets every fact, nothing
clipped, and a browser that never applies the animation still shows a
complete list. `globals.ticker.test.ts` pins that shape, including one
thing only a browser would otherwise have caught: the static rules must
come BEFORE the media block, because they share its specificity and the
later rule wins — the first draft wrote them after it and the motion's
`nowrap` lost to the static `wrap`.

Measured in a real browser: at 1440 the two copies are 9258px each to the
hundredth, `scrollWidth` is 1440 and the track moves 61px/s (150s per
copy; 90s read as a stock ticker); hovered, it moved 0px in 800ms and
reported `paused`, resumed on leave; focused, `paused` with the ring,
resumed on blur. At 375, `document.documentElement.scrollWidth === 375`
with the ticker running. With the motion rules disabled — what `reduce`
renders — all fourteen items wrapped inside the viewport (max right edge
338 of 375), clone `display: none`, no animation, no mask. 4 mutants
requested, 4 caught: a "100%" in a fact fails both the ticker's own guard
and the page-wide one; the static CSS moved below the media block fails
the order test; the clone losing `aria-hidden` fails the accessibility
test; the ticker wrapped in `<Reveal>` fails the placement test and the
derived reveal count.

Placement: directly under the hero, not between two lower sections. The
hero is the screen that was called empty and the only screen most visitors
see, so motion there is motion where it is looked at; and it is the one
spot where a band of many short facts is not competing with a section that
is itself making an argument.

Two of this repo's censuses caught the FIRST draft of the fact list, and
both were right: `rowActionsCensus.test.ts` tokenises every component and
treats a removal action's NAME as a call to it, so a receipt comment that
named the RFI delete action read as a delete with no confirm; and
`retainage-single-source.test.ts` enumerates every file naming the
retainage column, so a receipt naming it looked like a new reader. The
receipts were reworded to describe the behaviour rather than spell the
identifier — the censuses were not touched, and neither was given an
exception.

**Sixth round: the hero's left column, measured.** After the fact ticker
the founder pointed at one specific region in a screenshot: the space
under the Sign in button at desktop. Measured at 1440x900 before this
change: the hero's left column (subhead, trade chips, two buttons) was
**242px** tall beside a **578px** pay-application panel, leaving **336px**
of bare background below the last button. An earlier commit on this branch
(`a9ed980`) had already fixed the worse version of the same defect — the
row was `items-center`, which put the surplus as a 207px hole BETWEEN the
headline and the subhead; `items-start` moved the subhead to 40px under
the headline, where it belongs, and moved the surplus to the bottom.

The fix is content, not alignment or padding. Under the buttons the column
now carries **the paperwork the product produces**, by the names the trade
uses: pay applications (G702/G703-style — `lib/pay-application.ts`),
certified payroll (WH-347 — `lib/wh347.ts`), fringe remittance (one sheet
per local for the month — `union-compliance/remittance/page.tsx`), change
orders (numbered; the contract sum moves only on approval —
`changeOrderStates.ts` CONTRACT_EFFECT), RFIs (overdue derived from the
dates — `rfiLabels.ts`), submittals (revisions kept, never renumbered —
`SubmittalRevision`), daily field reports (crew from the day's hours,
weather fetched — `field-reports-core.ts`), T&M tickets (signed on site,
snapshot frozen at signing — `TmTicket`). Each carries its receipt as a
comment beside it. Two candidates were checked and LEFT OUT because the
app does not produce them as documents: lien notices (it tracks entered
deadlines and drafts nothing) and an OSHA 300 log (case numbers and
recordability, no rendered form). The subhead and chips also step up one
size at `lg` — `text-2xl` and `text-base` — where a 96px headline had left
20px and 14px undersized; that is part of the answer, not most of it.

The block is two columns at every width, including 375px, on purpose: on
a phone it lands between the buttons and the panel, and eight
single-column rows would push the panel most of a screen down. It is
prose, not a `data-landing-panel`, so the page-wide invented-statistic
guard reads it — "G702/G703" and "WH-347" carry digits, which is exactly
why it must not be wrapped as a panel to make a guard go quiet.
`app/page.test.ts` asserts the block is inside the hero, names every
document, and survives `stripPanels`.
