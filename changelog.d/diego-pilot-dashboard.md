### Internal: a pilot dashboard at /internal/pilots (Diego)
`diego/pilot-dashboard`

One row per customer company, most recently active first: jobs, plan sets, sheets taken off, wall
runs a person typed, wall runs auto-posted, the median time from a job's first upload to its first
signing link, problem reports (all time and 7 days), errors in the last 7 days, and last activity.
Read-only, counted on every load from rows the product already writes (`lib/internal/pilotMetrics.ts`).

**Gated like /internal/usage and /sales**: Prova's operating company AND its owner. A customer sees
"Not part of your access", which never names what the page shows. The operating company itself is
not a row. The sample job (#1120) is in no figure.

**Named for what is stored, not what was asked.** There is no log of review-queue presses, so the
column is wall runs a person typed (labels "… (set by hand)"), not presses; there is no per-company
error table, so "errors" is plan pages whose reading stopped on an error plus emails that failed or
bounced. Each column says so on the page.

Checks: `lib/internal/pilotMetrics.dbtest.ts` (every figure for two seeded pilots; the operator
never a row; the sample and anything older than 7 days kept out; red with either exclusion removed),
`e2e/specs/pilot-dashboard.spec.ts` (two test companies' figures as the operator; nothing as a customer).
