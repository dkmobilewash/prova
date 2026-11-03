### The billing click list runs as a local Playwright spec (Diego)
`diego/billing-click-spec`

`pnpm test:e2e -- --billing-click` (repo root) runs `e2e/local/billing-click.local.spec.ts`:
the billing click list's Parts 1 to 7 plus 7a, 7b, 7c, 12a, 16a, 17a and 19a, one test
per step, signed in through a real Chromium against a production build, over the same
`seedBillingClickFixture` the click list uses, in a throwaway Postgres. Downloaded CSV,
Excel and PDF files are read, not just seen to appear. Local only: it lives in
`e2e/local/`, which the CI `e2e` job's `testDir: "./specs"` never reaches, under its own
`e2e/playwright.billing.config.ts`.

It found one bug, fixed here. After the retainage is billed on a release application,
the closeout list's "Retainage billed" stayed Open and said "No retainage withheld on
this job's invoices." The release application's negative retainage nets the job's
withheld total to zero, and the check read that total first. A release application now
counts as the evidence. The unit test had passed a withheld figure the real loader never
produces after a release.
