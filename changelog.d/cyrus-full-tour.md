### "Take the full tour": one guided walk across the app for a brand-new account (Cyrus)
`cyrus/full-tour`

"Walk me through this page" explains one page. A new contractor does not know
which page to open first, so it never gets asked. The full tour is eleven
stops in the order a residential contractor would use the app: the day
(getting started, what needs you), Ask C Stream, starting a job, contacts,
the schedule, daily reports, photos, punch lists, the pipeline, getting paid,
and connecting Jobber/QuickBooks. Each stop opens the page with a client-side
router push, waits for the page to render, and shows one to three of that
page's EXISTING walkthrough anchors, re-narrated to say how the page leads to
the next one.

It is not a second overlay. `WalkthroughTour` gained an optional `journey`
prop — "Stop 3 of 11" in the header, Back on a stop's first card going to the
previous stop, "Next stop" / "Finish tour", Skip stop and End tour. Esc ends
it. `FullTour` in the app layout only moves between pages, and never clicks,
types or saves. The current stop is in sessionStorage, so a reload resumes it
and leaving the stop's page shows a small "Tour paused" note with Resume/End
instead of dragging anyone back.

A stop the viewer cannot open is dropped before numbering, using the nav's own
rule — `canOpen` in `navItems.tsx`, which the footer now uses too (capability,
plus owner-only Integrations). A stop whose page shows none of its anchors in
12 seconds is skipped.

Entry points: "Take the full tour" in the Help panel above "Walk me through
this page"; "New here? Take the 3-minute tour" on the getting-started card;
and a dismissible banner on the dashboard of an account with no jobs,
offered and never auto-started, dismissal remembered per browser.

The check: `fullTourCensus.test.ts` holds every stop to a real static page,
every anchor to BOTH that route's walkthrough and a `data-tour` literal its
page renders (the census helpers now live in `census-helpers.ts`, shared with
`walkthroughCensus.test.ts`), and counts the stops and anchors it checked
against the `route:`/`anchor:` literals in `full-tour.ts`'s source text.
Mutation-tested: an anchor removed from its page, a bad route, a duplicate
stop, an anchor outside the walkthrough, and a checker that skips a stop each
go red.
