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
