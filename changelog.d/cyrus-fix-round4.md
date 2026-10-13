### Fix round 4: links that land where they say, a dated time form, week-old RFIs, bids due soon (Cyrus)
`cyrus/fix-round4`

From a task-based usability run (all ten tasks done, the friction was after
the first click):

- **Anchors across pages now land.** `(app)/loading.tsx` defeated Next's own
  hash scroll: the router's scroll handler runs outside the loading boundary,
  fires on the skeleton, finds no element and is spent before the page
  streams in. So "Retainage held →" (`/cash-flow#retainage`) opened at the top
  of Cash flow. `components/shell/HashLanding.tsx`, mounted once in the shell (beside
  `NavigationProgress`), waits for the id to appear and scrolls to it. Check:
  `hashLanding.test.tsx` adds the section after the hash is set.
- **Log hours** lands on `crew#log-time`: the form now sits above the ~45 past
  entries and its date starts on the viewer's today, set in an effect after
  hydration (the form is server-rendered, so `localToday()` in its markup
  would break hydration). Today, not yesterday: either is a guess, and today
  is the one a foreman sees is wrong.
- **Change orders** — the Contract step's link and the Paperwork row both go to
  `/estimate#change-orders`, past the job-costing breakdown. No change-order
  logic touched.
- **Compliance "Open"** on an expired certificate linked to `/compliance`, the
  page it sat on, so it did nothing. It now links `#doc-<id>` and each document
  row carries that id.
- **RFIs with no due date** could never read as overdue, so ten days
  unanswered sat under "none overdue". `Rfi.dueBy` already exists and already
  drives overdue; for the RFIs without one, open rows say "asked N days ago"
  and ≥7 days reads **Waiting a week+** — on the row, the /rfis status line,
  Home's Paperwork area and the job's Paperwork panel. Derived, never stored.
- **Bids** opens on a **Due soon** view (`?view=due`) when an invited bid is
  due in the next 30 days: soonest first, with days left. `?view=all` is the
  old history. Read-only; no bid logic touched.
