### "Search or ask" replaces the sidebar as the way to reach everything (Cyrus)
`cyrus/g-search`

Concept G takes the left sidebar away, so search has to carry every door the
sidebar had. The ⌘K / Ctrl K palette (`components/shell/CommandPalette.tsx`)
opens from the top-bar box, the big home bar (`SearchTrigger`), or any
`cstream:open-search` event. With nothing typed it lists recent jobs, the four
shortcuts (New job, Log hours, Send pay app, Find an RFI) and every page the
person can open; typed, it groups Jobs / People / Documents / Actions / Pages
with the match highlighted, and a question or command ("bill Northgate for
October") gets one "Ask C Stream" row that opens `/ask` with the words filled
in — nothing runs until the person presses Ask.

It reuses the existing `globalSearch` (company-scoped, capability-gated
providers) rather than a second search. The transport moved from the
`searchApp` Server Action to `GET /api/search`, because Next runs Server
Actions one at a time per client: a slow query for "no" held "north" behind
it. A fetch is aborted on the next keystroke instead. The old
`SearchLauncher`, `searchApp` and `runSearch` had no other callers and are
gone.

Log hours and Send pay app happen inside one job, so they ask "which job?"
rather than guessing one — guessing would log hours on the wrong job.

The check: `lib/search/companyScope.test.ts` records every `findMany` the
providers and `recentJobs` make against a mocked client and requires each to
carry the caller's `companyId` (and requires the call COUNT, so an empty list
cannot pass). Removing `companyId` from the RFI provider turns it and
`app/api/search/route.test.ts` red.
