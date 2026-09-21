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
