### The mobile app exists; the audit said it did not (Diego)
`diego/audit-mobile-app` — FEATURE-AUDIT.md + ARCHITECTURE.md, no issue

Two documents carried the same false sentence in three places:
FEATURE-AUDIT Sheet 07's "Mobile/field time entry app" row was marked
Missing — "no dedicated field app; deliberately deferred" — Sheet 25's
"Field-only mobile access" row stayed Partial because "there is no
mobile SURFACE", and ARCHITECTURE.md said the same thing twice, once as
"deliberately not built in this pass" and once as "genuinely unbuilt".

All three were true when written and are not true now. `apps/mobile` is
a dedicated Expo app on `main`: time entry by crew member and job,
timesheet sign-off, punch lists, camera capture with GPS, drawings and
schedule — through an offline-first engine (write outbox, cached reads
that need no token, reads that never wait on the write) on the phone's
own calendar day. Tabs are capability-derived, and `/api/v1` serves the
same cores the web actions use.

The rows now say Partial, and the reasons are the ones that are
actually true: the app is not distributed (EAS is configured, the
Apple Developer Program is enrolled, but no TestFlight build exists)
and it has not been clicked through on a device end-to-end. Those are
the flips to Built, and the docs say so instead of hiding them.

**The check:** reading the three passages out of the two files names
`apps/mobile` and no longer claims the field app is missing, deferred
or unbuilt.
