### What actually changed, in plain English (Diego)
`diego/role-shell`

The phone shows what this person can actually do, and seven API routes
stopped handing out field records to anyone with a token.

**What was wrong.** Every screen was shown to everybody. An ACCOUNTING or
ESTIMATOR user got the whole foreman app — Create, Camera, punch lists,
hours — and discovered what they were not allowed to do by tapping and
getting a 403, which renders as an empty screen saying nothing at all.
The server was right; the shell was lying about what it could do.

`GET /api/v1/me` now answers with the capabilities the server DERIVES for
that person (`capabilitiesFor`, the same function the web uses), and the
phone hides what they cannot reach and says why. The phone carries no
copy of the rules: a second copy of who-can-do-what inside an app-store
binary goes stale the day somebody changes a job function, and cannot be
corrected without a release.

What that looks like: an ACCOUNTING user sees Home saying "Today isn't
your screen", the Jobs tab, and Settings — no Create, no Camera, and a
job with no rows on it and a sentence saying so. A PAYROLL_COMPLIANCE
user gets the field screens and not the drawings. A FIELD foreman sees
what they saw before.

**The phone's table of which screen needs which capability is checked
against the routes themselves.** `screen-capabilities.test.ts` reads the
capability each API route asserts and fails if the phone asks for a
different one — a shell that hides a screen the server would allow is a
foreman who cannot work, and one that shows a screen the server refuses
is the 403-after-you-tap this change exists to end. Neither is visible in
review, because both sides look reasonable alone.

**And then the census found that the shell would have been decoration.**
Seven routes asserted the capability on their POST and left their GET
open: delays, incidents, material orders, media, punch list, signoffs and
toolbox talks. A bearer token belonging to somebody whose job function
excludes field records could still READ a job's punch list, photos and
timesheet sign-offs. Two more — time entries and T&M tickets — asserted
nothing at all, on either verb, while the equivalent web surface has
withheld on MANAGE_FIELD since #396.

**The way that was found is the part worth keeping.** The first version of
that census searched each route FILE for `can(context, …)` and reported
all seven as guarded, because each file's POST had one. Reading per
EXPORTED HANDLER is what surfaced them — the same shape as the census that
asked whether a screen CALLS `cachedRead` rather than whether the call is
reachable, and as the SQL census that parsed 180 of 181 foreign keys. The
check was not lying; it was answering a question nobody had asked. It now
also asserts the number of handlers it examined, so a walk that stops
matching fails loudly rather than passing everything downstream.

**Two deliberate decisions.** A phone that has never been online — no
`/api/v1/me` answer and nothing cached — shows the WHOLE app rather than
hiding it: the server still refuses what this person may not do, and one
honest sentence beats a dead phone in a basement. And the open routes
that stay open (the job list, crew, crafts, vendors, cost codes, the
apprentice ratio, device tokens, media tags, `me` itself) are listed with
a reason each, and the census fails if one of them quietly grows a guard
or disappears.

Checks: 4 shell-table cases and 3 API-guard cases, each mutation-tested —
a screen that stops checking, a phone asking for a different capability
than the server, a GET losing its guard, and a guard moved after the
query all go red. 7 rendered cases across punch list, drawings, time, the
job hub and Home, including the never-been-online one. 5 cases on
`/api/v1/me` covering the owner rule and the no-job-function rule, so
nobody loses access to this shipping.
