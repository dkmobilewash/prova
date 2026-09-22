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
