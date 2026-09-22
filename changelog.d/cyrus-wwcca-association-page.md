### A page for WWCCA member contractors — built, not published (Cyrus)
`cyrus/wwcca-association-page`

`/associations/wwcca` is a page written for members of the Western Wall &
Ceiling Contractors Association, shaped after Siteline's per-association
pages and narrowed to the one argument that is ours: on a union public job
the same hours feed the WH-347, the trust-fund remittance and the
apprentice-ratio check, and the pay application comes off the same job's
schedule of values. It reuses the landing page's four product panels,
offers to load a member's data for them, and carries C Stream's
founding-member offer to the first 10 member companies: $399 per month per
company, flat, unlimited users, with the first 60 days free as onboarding
(we load the data and run one real billing cycle), and no counter. The lock
length, any discount percentage and AI allowances are undecided and are not
on the page.

**It is not live, and must stay unlinked until the association has seen it
and approved the use of its name.** There is no partnership, endorsement or
member-discount program with the WWCCA, and the relationship between its CEO
and a founder makes anything that looks like one harmful. So: `noindex,
nofollow`, hard-coded; linked from nowhere; and `WWCCA.enabled = false` in
`components/associations/wwcca.ts` turns the route into a 404 in one line.
Indexing is deliberately NOT behind that flag — a boolean that turns search
on is one somebody flips to see if it helps.

The check: `app/associations/wwcca/page.test.ts` fails the build if any file
under the web app, the shared UI package or `public/` links to
`/associations`, if the robots metadata changes, if partnership language or
any image but our wordmark appears, if any dollar figure other than the set
price, a percentage, "trial", an AI allowance, a lifetime promise or a
scarcity counter appears outside the illustrative panels, and — executed,
not read from source — if the switch stops producing a 404.

One claim from the brief was NOT written: that the hours feed the pay
application. They do not — a G702/G703 bills against the schedule of values
— so the page says the pay application comes off the same job's line items,
which is true (`scheduledValueFor` in `lib/pay-application-query.ts`).

**Remodelled before the committee sees it (Cyrus, 2026-09-21): shorter, no
limits section, a two-column hero, and a logo slot that is OFF.**

- **The hero had an empty right half at ~1500px** — a left-aligned headline,
  a paragraph and two buttons, then bare background: the landing page's hole
  before #404. It is now two columns at `lg`, with `CertifiedPayrollPanel`
  (the week's hours laid out as a WH-347 by `buildWh347`) on the right.
  Certified payroll, not the pay application the landing page leads with,
  because the headline is about hours and the pay application is not built
  from them. `items-start`, not `items-center`, with the landing page's
  reason in a comment. Top-aligning alone moved the surplus under the
  buttons (407px column beside a 726px panel); that was closed with content,
  not padding: the trades and a three-item "From one entry of hours" list.
  After: 624px beside 726px at 1500x950.
- **"What it does not do yet" is gone,** replaced by a stricter rule rather
  than a silence: every claim on the page is true as written, each carries
  its receipt in a comment, and nothing implies a missing feature. The page
  says C Stream BUILDS the WH-347; it never says certified payroll is filed
  or file-ready (page 2, the Statement of Compliance, is not built), never
  that overtime is calculated (it is entered), and never that the
  remittance is ready to mail (it holds no fund numbers or addresses).
- **Visible words outside the panels: 1,152 before, 329 after** (whole
  page including panels: 1,991 to 1,168), counted from the server-rendered
  markup. One line per idea; the four panels carry the detail.
- **Tailored:** the trades as a member names them (metal framing & drywall,
  lath & plaster, EIFS, acoustical ceilings, fireproofing), and the ratio
  line speaks of a local's JATC standards (`ApprenticeRatioRule` records
  each local's rule with where it is written down). Nothing is said about
  the WWCCA itself beyond its name.
- **The logo slot:** `WWCCA.logoSrc` in `components/associations/wwcca.ts`,
  `null`. While null the hero renders no lockup and no gap. A trade
  association's logo needs its written permission, and showing it earlier
  would imply the endorsement this page exists to rule out. `wwcca.ts` now
  carries the list of what the association must approve, logo included.

The checks. `page.test.ts` now fails if: the WH-347 leaves the hero or
appears twice; the hero grid is `items-center`; the page says payroll is
filed / file-ready, overtime is calculated, or the remittance is ready to
mail (whole page, panels included, and it asserts the documents are still
NAMED so those regexes cannot pass on a page that stopped mentioning them);
the limits section comes back; or `logoSrc` is anything but null. A second
test sets a logo and confirms the slot renders, so it works when it is
needed. Every one of the claim guards and the `items-start` guard was
mutation-tested red.

Two censuses that reached this branch from `main` flagged the page, both
correctly. `publicRoutes.test.ts` requires every public route to be walked at
phone width, so the route is in `e2e/lib/publicRoutes.ts`, and
`pnpm test:e2e:public` measures it at 320, 375 and 1280 (it asserts the layout
viewport, `window.innerWidth`, equals the device width). That suite runs
LOCALLY only: `e2e/run.mjs` mentions a `.github/workflows/e2e.yml`, and no
such workflow exists on `main` — so no PR check walks this page. And
`routeInboundLinks.test.ts` requires every page to have an inbound link or a
reason not to; this one is unlinked on purpose, so it is listed as reached
from outside the app, and the page's own no-links test exempts that one test
file by exact path.

Known and not fixed here: at 320 the WH-347's narrow grid is wider than its
272px panel and scrolls sideways inside the panel (Saturday and the total are
off the right edge until scrolled). The page does not overflow. The panel is
the landing page's own and does the same there.

**Two sections added (Cyrus, 2026-09-21): the assistant in few words, and a
savings calculator from the visitor's own numbers.**

- **The assistant, honestly.** "Tell it what you need and it does it — it
  raises the RFI, drafts the invoice, logs the hours, schedules the crew,
  sends the email. You tap once to approve anything that gets saved or
  sent." Then four groups — Billing, Field, The GC, Estimating — and each
  group's comment in `WwccaLanding.tsx` names the write commands it stands
  for. `page.test.ts` reads those names out of the source and compares them
  with the `CommandName` union in `lib/ask/commands.ts`, both ways: a command
  the page names that the code lacks fails, and a command the code has that
  the page leaves out fails. The union's size is pinned to the count of tool
  `name:` declarations across `lib/ask/commands/`, so an empty parse cannot
  pass. "Fully AI automated" is false — every write is a proposal card and a
  person's tap runs `confirmAskProposal` — and the test bans it and its
  cousins ("fully automated", "hands-free", "no data entry", "files for
  you", "file-ready", "automatic … overtime", "remembers") over the whole
  rendered page, after first asserting the protected sentence is present, so
  the guard fails on an empty render rather than passing one. Ask does keep
  the earlier turns of one sitting (`priorTurns`, `lib/ask/turns.ts`); it
  keeps nothing across sittings, and the page claims neither.
- **The calculator.** Five labelled fields, each with its default's
  provenance printed beside it: crew size 25 (example, for scale; the
  formula does not use it), office hours per week 10 (example, use your own
  — NOT the unsourced "8.3 hours/week"), loaded hourly cost $38 (BLS
  payroll-clerk mean $26.29/hr, May 2023, loaded at wages ≈ 70% of employer
  cost per BLS ECEC, linked, and the $26.29 re-read off the BLS page on
  2026-09-21; California about $42), what you pay now $750/month (example,
  with two public price lists for reference), and the share of office time
  removed, 50%, labelled an assumption. **The two reference prices are not
  the ones the brief supplied.** It quoted "$1,000–$5,000/month" for
  certified-payroll managed services from certifiedpayrollpro.com and
  "$99–$399/month" for Knowify; both sites were read on 2026-09-21 and
  neither figure is on them — certifiedpayrollpro.com lists software plans at
  $49, $99 and $249 a month plus a per-report fee, and knowify.com/pricing
  lists Core $99 and Advanced $329. The page carries the checked figures with
  the date, since a reference a committee member can look up and find wrong
  is worse than none. Formula in `components/associations/wwccaSavings.ts`:
  now = current + hours × 4.33 × rate; with = $399 + remaining hours × 4.33 ×
  rate; saving = now − with, monthly and ×12. **If C Stream costs more, the
  saving is negative and the sentence says "costs you … more" — nothing
  clamps.** Money is computed in cents and rounded once (render-hours.ts's
  lesson); inputs are sanitised so empty, text, negative or enormous entries
  give finite figures. CSS bars, no dependency, `aria-hidden`, with the result
  as a sentence in a live region and a figures table for screen readers.
  The $399 is parsed out of `FOUNDING_OFFER.price`, so the calculator cannot
  quote a price the offer does not. The section is marked
  `data-savings-calculator`; `page.test.ts` strips it from the prose the way
  it strips the panels, asserts it is there to strip, and asserts every
  default renders with its source beside a `<label>`led input. Ends with
  "An estimate from the numbers you enter, not a quote."
- **The Ask demo was not here at first;** the section carried a comment
  marking where it would mount. It is mounted now — see below.
- Mutation-tested red: clamping the saving at zero, skipping the cents
  rounding, a banned phrase on the page, a command named that the code lacks
  (which passed the first time — the census regex excluded digits, so
  `file_wh347` was never parsed; fixed), a real command dropped, and a
  default losing its source line.

**The Ask demo, beside the assistant's words (Cyrus, 2026-09-22).** #457
put `components/landing/AskDemo.tsx` on the landing page (about twenty
seconds, two real commands, each confirmed by a tap). It now sits in the
assistant section's marked slot, reused as-is.

- **Two columns at `lg`, `items-start`,** with the heading moved into the
  left column so the demo's top lines up with it (the landing page's shape).
  Top-aligned for the landing page's 207px-hole reason. Phones stack: the
  words first, the demo last.
- **One list.** The landing page puts `AskCanDo` beside the demo; this page
  does not, because `ASSISTANT_DOES` is its list already. The two lists were
  checked and do agree: the same four groups and the same twenty commands.
  A new test pins them to that, group by group, so they cannot drift apart.
- **The demo's width and height, measured in a production build over a full
  loop.** The first placement used `lg:justify-self-end` as the landing page
  does. That shrink-wraps the cell to each frame, so the demo's left edge moved
  189px (822 to 1011 at 1500) as frames changed. It is now a full-width flex
  cell pinned right, and the left edge is constant. Height was the larger
  problem. The demo runs 202 to 580px against a 394px column, so the row
  followed the frame, and the calculator below moved 192px every loop while it
  was on screen with it. The cell now reserves the tallest frame at `lg`
  (`lg:min-h-[620px]`; tallest measured 618px at 1024 and 580px at 1280, 1500
  and 1920). The calculator's top is fixed across every frame: 3751px at 1500,
  4177px at 1024. There is no reserve under `lg`: the tallest frame at 320 is
  890px against a shortest of 212px. At 375 and 320 `window.innerWidth`
  equalled the device width and `scrollWidth` equalled it too, on every one of
  ~160 samples across all 26 steps of the loop. There was no overlap. The
  calculator moves with the demo on a phone, below it, never over it.
- **The guards see every frame, not just the still.** The server renders one
  frame (the settled hours card), so `page.test.ts` collects every string
  value exported by `askDemoScript.ts`, the status lines each frame computes
  and the JSX text in `AskDemo.tsx`. It holds them to the page's endorsement,
  dollar, percentage, trial, AI/allowance, scarcity, lifetime, filing,
  overtime, remittance and banned-assistant patterns, which are now named once
  and shared rather than inlined per test. The collection must contain both
  prompts and the caption, and more than 40 strings, so an empty scan fails.
  The demo is a `<figure>`, so the prose strip now removes only the four
  panels' figures and leaves the demo in the prose scan. The panel counts
  (4, each captioned) are unchanged.
- Mutation-tested red: a banned phrase in a frame the server never renders
  (the hours prompt), a dollar figure in the RFI question, partnership
  language in `AskDemo.tsx`'s own JSX, `items-center` on the grid, a command
  moved between groups, `AskCanDo` rendered alongside, and the demo removed.

**The crew-size box now does something (Cyrus, 2026-09-22).** It was
collected, labelled "Shown for scale; the result is per office, not per
worker", and never read by the formula. Cyrus's call: keep it, and make it
show the saving per worker per month.

- **What it shows.** Directly under the result sentence, inside the same
  live region: "That is about $47 per worker a month, across 25 people." It
  is the monthly saving DIVIDED by the crew size — money per worker per
  month and nothing else. There is no "hours saved per worker" figure,
  because nobody has measured one and this page invents no statistic. The
  crew size is named in the sentence so a reader can see what the figure was
  divided by. The office figures (hours, rate, spend) are still per office
  and the crew size touches none of them; a test asserts every other field
  of the result is identical at crew 1 and crew 500.
- **When there is no crew to divide by — 0, empty, "abc", negative, or a
  fraction below 1 — there is no per-worker line at all.** Not a dash, not
  $0, and never "$NaN" or "$∞". `savingPerWorkerMonthly` is `null` in that
  case and the component renders nothing for `null`. The existing junk-input
  test now also requires that field to be null or finite for every junk
  value, never NaN and never Infinity.
- **When C Stream costs more, the per-worker line says so in the result's
  own voice:** "That is about $9.38 per worker a month more, across 25
  people." Nothing clamps at zero, for the formula header's reason: a
  calculator that cannot lose is an advertisement. The sign lives in the
  word "more"; no minus sign reaches the screen.
- **Rounding.** The saving is already whole cents, so the division is the
  one place dust can enter and the one rounding it gets (`Math.round` of
  cents ÷ crew), the file's cents-first discipline. Whole dollars from $10
  up ("about $47", because $46.95 is an "about"), `money()`'s two decimals
  below that so a small figure reads "$1.17" and never "$0". Checked by
  hand: the defaults give $1,173.70 ÷ 25 = $46.95; ÷ 7 = $167.67; ÷ 1,000 =
  $1.17 with no float dust; the costs-more example −$234.46 ÷ 25 = −$9.38.
- **The source line is fixed.** "Shown for scale; the result is per office,
  not per worker" became false the moment this landed, so it now reads: "use
  your own. The office figures are per office, not per worker; the crew size
  divides the monthly saving to give the per-worker line." Still an example
  (25 is the shop size the flat price is written for), still rendered beside
  the field with `page.test.ts` asserting it. The formula header, the
  `crewSize` field comment (which said "the formula does not use it") and
  the component header were all rewritten — a comment left standing after
  the code grew past it is this repo's most expensive recurring bug.
- **Mutation-tested red, three ways, each restored and re-run green:**
  (1) the `crew < 1` guard removed, so the division reaches the result —
  three tests fail: `crew 0: expected Infinity to be null`,
  `savingPerWorkerMonthly for : expected false to be true` (the
  finite-for-junk test), and the page guard
  `crew 0: expected 'That is about $∞ per worker a month, …' to be null`,
  which is the literal text the page would have shown; (2) the sign flipped
  on the costs-more case (`Math.abs` on the saving) — three tests fail,
  `expected 9.38 to be -9.38` and `expected 23.45 to be -23.45`; (3) the
  component treating `null` as $0 — the page guard fails with
  `expected 'That is about $0.00 per worker a mont…' to be null`.

**The Ask demo is now the first thing a visitor sees (Cyrus, 2026-09-22).**
It moved out of the assistant section and into the hero: beside the headline
at `lg` (headline left, demo right), and ABOVE the headline on a phone, where
it is first and full width. The WH-347 panel that stood in the hero's right
half is now the first panel below it, flipped to the left so the page
alternates sides from the demo down. The assistant section keeps its words
and its one list; it is a single `max-w-3xl` column now rather than a
half-empty grid.

**Measured in real Chromium against a production build** (`next build` +
`next start`), sampling every 100ms at each width: 259-260 samples, all 26
steps of the scene and one wrap of its clock, so each run saw a full loop.
Nothing in the unit suite can see any of this — happy-dom does no layout and
returns zeros from `getBoundingClientRect`. BEFORE is the branch as committed
at `120528a9` with current `main` merged in, built and served the same way;
AFTER is this change.

| width | | demo width | demo height (min → max) | its cell's height | y of the first element BELOW THE HERO | y of the first element below the demo's own section |
| --- | --- | --- | --- | --- | --- | --- |
| 1500 | before | 544, **delta 0** | 201.9 → 603.9 | 620, delta 0 | 1010.1, delta 0 | 3767.5, delta 0 |
| 1500 | after | 540, **delta 0** | 201.9 → 603.9 | 620, delta 0 | 999.8, **delta 0** | same element, delta 0 |
| 1280 | before | 544, **delta 0** | 201.9 → 603.9 | 620, delta 0 | 1010.1, delta 0 | 3767.5, delta 0 |
| 1280 | after | 540, **delta 0** | 201.9 → 603.9 | 620, delta 0 | 999.8, **delta 0** | same element, delta 0 |
| 1024 | before | 460, **delta 0** | 201.9 → 623.9 | 620 → 623.9, **delta 3.9** | 1331.3, delta 0 | 4407.2 → 4411.1, **delta 3.9** |
| 1024 | after | 540, **delta 0** | 201.9 → 603.9 | 620, delta 0 | 1331.3, **delta 0** | same element, delta 0 |
| 375 | before | 327, **delta 0** | 211.8 → 769.8 | 211.8 → 769.8, **delta 558** | 2001, delta 0 | 6454.9 → 7012.9, **delta 558** |
| 375 | after | 327, **delta 0** | 211.8 → 769.8 | 780, delta 0 | 1835.1, **delta 0** | same element, delta 0 |

**Nothing below the hero moves, at any of the four widths, before or after.**
The BEFORE column of that is not a compliment to the old layout — the demo
sat far down the page, so the hero could not have moved. The movement the old
layout did have is the last column: the savings calculator, which sat on
screen with the demo at `lg`, drifted **3.9px** every loop at 1024 (the old
`lg:min-h-[620px]` was that much shorter than the 623.9px frame the narrower
1024 track produced), and on a phone it moved **558px** every loop. Both are
zero now. The headline's own y is constant too — 188px at every `lg` width,
972px at 375 — which is the number that matters on a phone, where the
headline is what sits directly under the demo.

**The height reserve is the right size, and the margin is written down so
the next person does not have to re-derive it.** The cell reserves in three
tiers, because the tallest frame depends on the figure's width (narrower
wraps taller). Each tier measured over a full loop:

| viewport | reserve | tallest frame | headroom | what sets the row |
| --- | --- | --- | --- | --- |
| 320 | 950px | 949.8 | **0.2px** | the reserve |
| 375 / 376 | 780px | 769.8 | 10.2px | the reserve |
| 639 | 780px | 587.9 | 192.1px | the reserve |
| 640 (`sm`) | 620px | 603.9 | 16.1px | the reserve |
| 1024 | 620px | 603.9 | 16.1px | **the words column, 1099.3px** |
| 1280 / 1500 / 1920 | 620px | 603.9 | 16.1px | **the words column, 767.8px** |

So at `lg` the reserve never binds: the words column (eyebrow, headline,
line, trades, buttons, FROM_THE_HOURS) beats the tallest frame by 495.4px at
1024 and by 163.9px from 1280 up, and it is the column that sets the row. The
620px tier is insurance for the day someone cuts that copy — sized off the
tallest 34rem-wide frame so it would hold the row at 620px instead of letting
it follow the frame. Under `lg` the reserve is load-bearing and the numbers
are tight by design: 0.2px of headroom at 320 and 10.2px at 375. **If the
script gains a taller frame, those two tiers are wrong by exactly the
difference — re-measure.** The price of the reserve is page background
between a short frame and the headline: up to 568px at 375, 192.1px at 639.
That is the trade for the demo coming first.

**The two bugs #459 named have not come back.** The demo's width is constant
across every frame at every width measured — 540 at `lg`, 327 at 375, 272 at
320, delta 0 on all 259-260 samples — so nothing slides sideways the way the
`lg:justify-self-end` cell did (170.1px on the landing page, 189px here). And
the cell does not overflow its track: at 1024 the figure's right edge is
1000px and the words column's right edge is 404px, a constant 56px gap (the
`lg:gap-14`), so the scene never paints over the words beside it.
`window.innerWidth` equalled the device width and `scrollWidth` equalled
`innerWidth` on every sample at 320, 375, 376, 639, 640, 1024, 1280, 1500 and
1920: no horizontal page scroll, ever.

**The guards went up, not down.** `page.test.ts` is 40 tests and 135
assertions, from 39 and 120. The new one reads the demo's cell off the markup
and requires `order-first` with `lg:order-none` (phone-first, desktop back in
its slot), `lg:flex` + `lg:justify-end` with **no** `justify-self` (the #459
shape, banned rather than described), `lg:items-start`, `min-w-0` and a
`min-h-[…]` reserve present — the reserve's SIZE is a browser measurement and
stays in the component's note, but a refactor that dropped it fails here. The
hero test now requires exactly one `<figure>` in the hero and that it is the
demo, with no panel figure and no "Form WH-347" text in it; the WH-347 test
requires that panel to appear exactly once and BELOW the first `</section>`.
Nothing was relaxed.
