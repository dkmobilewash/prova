### Five loose ends from the Concept G review, and /hours goes office-only (Cyrus)
`cyrus/fix-polish`

- **⌘K page results name the area, not the old rail.** "Schedule — Daily
  work" and "Team — Compliance & safety" sat beside area pages that file
  those pages under Crew & field. `navPagesFor` now runs the nav through
  `pagesByArea` (moved from AllPagesMenu.tsx to lib/areas.ts so server code
  can call it), the same mapping "All pages" uses. `lib/search/query.test.ts`
  fails if any page result carries a heading that is not an area.
- **Home's Money card says "Pay app".** It counted "Overdue · 1 invoice"
  while Needs, the job cards and the Billing tab said "Pay app" for the
  same bill. It now takes `billingNoun(company.filesMonthlyPayApps)`, as do
  the two "invoices" sentences under it. `homeParts.render.test.tsx`.
- **/hours wears the shared header**: Home / Crew & field / Hours.
- **/hours is office only.** Cyrus's call. `ROUTE_CAPABILITY["/hours"] =
  MANAGE_COMPLIANCE`, the capability that already gates timesheet sign-off
  and certified payroll — so a foreman no longer sees it in the nav, the
  Crew & field tools or status line, or the crew tab's "Every job's hours →"
  link. He still reads his own job's hours on that tab. Note PROJECT_MANAGER
  holds no MANAGE_COMPLIANCE, so a PM loses /hours too. `lib/areas.test.ts`.
- **A bid waiting on the Jobs & bids area opens the bid** (`/ai/bids/<id>`),
  not a hash on the /bids list. `lib/areas-data.test.ts`.
