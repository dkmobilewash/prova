### "Walk me through this page" on twelve more pages (Cyrus)
`cyrus/walk-wave2b`

Tours now cover phase codes, site photos, prevailing wage, RFIs, safety,
settings, submittals, team, union fringe and apprentices, vendors, vendor
pricing and deployment. Each page got `data-tour` attributes on real
elements and nothing else; every step for an empty state (no jobs, no
vendors, not the owner) is written too and simply skipped when it is not
on screen.

Two nav pages were deliberately NOT given a tour and stay on
`ROUTES_WITHOUT_WALKTHROUGH` with the reason beside them: `/sales` and
`/internal/usage` are C Stream's own operator pages, and a customer only
ever sees "Not part of your access" there.

One test changed meaning rather than just passing: `engine.test.ts` used
"`/settings` has no tour" as its proof that sub-pages do not inherit a
parent's tour. `/settings` has one now, so the check is `/settings/export`
(no tour) resolving to null while `/settings` and `/settings/import` each
resolve to their own.

The check: removing any one anchor turns the census red (tried on five —
photos, safety, union compliance, settings, vendor pricing — five of five
went red on two tests each).
