### A subscribable crew-schedule calendar, and CompanyCam photo import (Cyrus)
`cyrus/cal-companycam`

Two self-contained verticals, both Cyrus's lane.

**The calendar feed.** `/schedule` now has "Subscribe in your calendar": a
per-person, tokenized `GET /api/calendar/<token>.ics` a foreman pastes into
Apple/Google/Outlook once and never touches again. It serves exactly what
that page already shows — the company's crew-schedule board, ±14 days —
because a subscribed feed that showed less than the page would read as a
bug, and one that showed more would leak schedule to whoever holds an old
link. Every event is a `VALUE=DATE` all-day event, never `DATETIME` —
this app's dates are UTC-midnight calendar days, and a `DATETIME` would
timezone-shift "Tuesday the 22nd" into Monday evening for half the country.
UIDs are `job+day`, so an edited note replaces the subscriber's event
instead of duplicating it, and CRLF line endings plus 75-octet folding (by
UTF-8 byte, never mid-character) keep the output RFC 5545-legal for every
client that reads it. Token minting follows `lib/tokens.ts`'s `linkToken()`
— the same generator the portal and e-sign links use, 192 bits — and
Regenerate is the two-step `ConfirmDelete` control: the old link 404s the
instant the new one is confirmed, byte-identical to a token that never
existed. `ics.test.ts` holds the golden output plus fold/escape/UID-
stability cases; `route.test.ts` proves a token never crosses a company or
survives its owner leaving one.

**CompanyCam.** Self-serve OAuth (confirmed against CompanyCam's own docs,
2026-09-19 — no partner-programme gate, unlike Procore), so this is the
Jobber/Procore shape rather than myCOI's file-import one: connect on
Settings → Integrations, link a CompanyCam project to a job, press Import
photos. Each photo becomes an ordinary `JobMedia` row in this app's own
blob store — captioned, dated by its own `captured_at`, tagged like any
other photo — with `JobMedia.companycamPhotoId` as the one provenance mark
and the re-import guard (`@@unique([jobId, companycamPhotoId])`). Read-only
by construction: the client's only method literal reaching CompanyCam's API
is `"GET"`, checked structurally so a future write can't slip in
unnoticed. Refresh is a compare-and-swap on CompanyCam's single-use refresh
token, the same shape `procore/connection.ts` already uses.

**What the wiring turned up.** The components (`CompanyCamControls`,
`CompanyCamLinks`) existed on disk from an earlier session but were never
imported anywhere — the Integrations page had no CompanyCam card at all.
Wired in now as a new `photo-import` `ProviderImplementation` kind
alongside Procore's `feed`, since the shapes differ (an explicit Import
press, not a live-refreshed read). Also found and fixed while wiring:
`CompanyCamProjectLink` carried a `jobId` and a comment claiming it was
"also listed in scratch-scope.mjs HANDLED_MODELS" — it was not, in either
cleanup script. A scratch job with a linked CompanyCam project would have
made `clean-test-jobs.mjs` refuse the whole run, the exact shape CLAUDE.md
already has two entries about (InvoiceCounter, the FK-parser regex). Fixed
in `scratch-scope.mjs` and both scripts' `del()` order before this shipped,
not after.

**Tests.** `ics.test.ts` (golden output, folding at a UTF-8 boundary,
escaping, UID stability, mutation-tested — flipping CRLF to LF fails 4
cases), `calendar-feed.test.ts` (pure grouping/UID logic), `route.test.ts`
for `/api/calendar/[token]` (dead-token 404s are byte-identical regardless
of cause; tenant scoping in both directions; mutation-tested — dropping the
company-move check fails 2 cases), `companycam-client.test.ts` (pagination,
retry/backoff, refresh, the GET-only structural guard), `companycam/
import.test.ts` (no duplicates on re-import including a simulated unique-
constraint race, tenant scoping on the link lookup, mutation-tested both
ways), `companycam/setup.test.ts` (the missing-config card's states).

Migration `20260919200000_add_calendar_feed_and_companycam`: two new
tables (`CalendarFeedToken`, `CompanyCamProjectLink`), one nullable column
(`JobMedia.companycamPhotoId`) with its own unique index, one new
`IntegrationProvider` enum value. No existing column changed, no backfill,
no trigger.
