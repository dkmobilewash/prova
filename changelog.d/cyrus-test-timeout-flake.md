### The suite stops failing on a different file every run (Cyrus)
`cyrus/test-timeout-flake`

`vitest.config.mts` set no `testTimeout`, so 5,919 tests — including page
renders and property sweeps — ran on vitest's 5000ms default. On 2026-09-21
five DIFFERENT files timed out at exactly 5000ms across runs on one machine,
each passing in seconds alone: correspondence-dates, field-reports-core,
billing/retainage-amount, ask/attachmentStream, ask/injection.batch.

The cost was never a slow test. It was that "the suite is green" stopped
meaning anything. Three reviewers hit it independently in one afternoon and
each had to re-run in isolation to learn whether their own diff was at fault;
one full-suite claim in a PR body turned out to have been measured on a
different base, and nobody could tell from the outside.

A red that is usually noise is a red nobody believes on the day it is real.

`testTimeout: 30_000` — roughly 5x the slowest legitimate file, while still
catching a genuine hang. Proved both directions: the five files pass together;
a test awaiting a promise that never settles still fails, at 30000ms.
