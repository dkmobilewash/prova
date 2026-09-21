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
