### A page for WWCCA member contractors — built, not published (Cyrus)
`cyrus/wwcca-association-page`

`/associations/wwcca` is a page written for members of the Western Wall &
Ceiling Contractors Association, shaped after Siteline's per-association
pages and narrowed to the one argument that is ours: on a union public job
the same hours feed the WH-347, the trust-fund remittance and the
apprentice-ratio check, and the pay application comes off the same job's
schedule of values. It reuses the landing page's four product panels, names
what the product does NOT do yet (WH-347 page 2, overtime is entered not
calculated, the remittance sheet's missing fund and member numbers, no
payroll), offers to load a member's data for them, and carries C Stream's
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

**The hero had an empty right half at desktop width, and now carries the
WH-347.** At ~1500px the top of the page was a left-aligned headline, a
paragraph and two buttons, with nothing beside them — the landing page's hole
before #404. The hero is now two columns at `lg`: the words on the left, and
on the right `CertifiedPayrollPanel`, the week's hours already turned into a
WH-347 by `buildWh347`. Certified payroll rather than the pay application,
because the headline is about hours and the pay application is the one
document on this page not built from them. The panel MOVED up from the panel
section rather than being copied, so the WH-347 appears once; the three rows
left below still alternate sides.

`items-start`, not `items-center`, with the landing page's reason in a
comment. Top-aligning alone moved the surplus under the buttons — measured at
1500x950: left column 407px against a 726px panel, ~320px of bare background
beside the panel's lower half, which is the landing page's third "looks
empty". Closed with content, not padding: three lines on what the certified
payroll does sit under the buttons (two of them are the ones that sat beside
this panel lower down). After: left column 672px, panel 726px.

Phone widths, measured in a real Chromium against a production build: at 375
and 320 the panel stacks below the copy, and `window.innerWidth` is 375 and
320 — the layout viewport itself, not only `scrollWidth`. The route is now in
`e2e/lib/publicRoutes.ts`, which `publicRoutes.test.ts` had started demanding
once `main`'s public-route census reached this branch; so the public e2e job
walks this page at 320, 375 and 1280 on every PR. `page.test.ts` fails if the
WH-347 figure leaves the hero, if it appears twice, or if the hero grid is
`items-center`.

Known and not fixed here: at 320 the WH-347's narrow grid is wider than its
272px panel and scrolls sideways inside the panel (Saturday and the total are
off the right edge until scrolled). The page does not overflow. The panel is
the landing page's own and does the same there.
