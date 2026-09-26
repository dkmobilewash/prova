### Where a job actually is, bid to warranty — and two audit rows that were already wrong (Diego)
`diego/job-lifecycle`

Three Partial rows were left in this lane. **Two of them turned out not to
be builds at all**, which is most of what this PR is worth recording.

## The lifecycle row was asking for the wrong thing

"bid → awarded → active → substantially complete → closed/warranty"
against a four-value `JobStatus` reads like an enum short by two. It is
not. Every stage already existed, and two of them as better things than
enum values:

| stage | where it already lives |
| --- | --- |
| bid / awarded / active | `JobStatus` |
| substantially complete | `Job.substantialCompletionDate`, a DATE |
| closeout / closed | `CloseoutSubmission`, with its own status chain |
| warranty | `WarrantyPeriod` (`startsOn` + `months`) |

`substantialCompletionDate`'s own schema comment says it outright: *"A
plain field, not a JobStatus stage."* Adding `SUBSTANTIALLY_COMPLETE`
beside a date it can disagree with is precisely what "derived state is
never stored" forbids — two answers to one question and no rule for which
wins.

**What was actually missing is that nothing DERIVED the stage for a
reader.** That date drives the retainage release forecast, the closeout
row and the cash-flow forecast; nowhere did the app say "this job is
substantially complete". The figures knew and the person did not.

`lib/job-lifecycle.ts` is pure, takes the reader's calendar day as a
parameter rather than reading a clock, and returns the stage with **the
evidence behind it** — a label with no `because` is the app asserting
something about somebody's job.

Three decisions worth the space:

- **Furthest stage wins.** The inputs overlap on purpose: substantially
  complete while still punching out is normal, not a contradiction.
  Ranking and taking the furthest needs no priority table, and it means
  the stage cannot go BACKWARDS because somebody edited a status — a
  closed job flipped back to CONTRACTED does not un-accept the package
  the GC signed.
- **A future date is a plan, not a fact.** A substantial-completion date
  pencilled in for December does not make a job substantially complete in
  September.
- **An expired warranty adds nothing.** It is not a further stage; the
  obligation is over and the job is closed. A "warranty expired" stage
  would put every old job into something that reads like an event just
  happened.

And a fourth, which is why `source` exists: the header already shows the
status pill, so a lifecycle line that merely restates it reads *"In
progress — the job's status is in progress"* and teaches a reader that
the line is filler. `source === "status"` means nothing was learned and
the header stays quiet.

| mutation | result |
| --- | --- |
| treat a FUTURE completion date as reached | RED, 2 failed |
| month arithmetic overflows instead of clamping | RED, 2 failed |
| an expired warranty still counts as running | RED |
| earliest stage wins instead of furthest | RED, 13 failed |
| an unknown status silently becomes "in progress" | RED |
| a rejected package reads the same as one in flight | RED |

The clamp one is not academic: a one-month warranty from 31 January ends
28 February, and naive month arithmetic gives 3 March — three days of
reporting a warranty as live after it ended.

## The metadata row was wrong about a field that already existed

"no distinct project ADDRESS" is false. `Job.siteAddress` is entered on
`JobDetailsForm`, geocodes to `siteLatitude`/`siteLongitude`/
`siteTimeZone`, and is read by the job page, field reports, both DAS forms
and the calendar feed.

**That row has now been wrong twice in two weeks about fields that were
already there** — the substantial-completion half of it was corrected the
same way on 2026-09-12, also "found while reading this sheet for something
else". Both corrections came from reading the schema rather than from
anybody hitting the gap, which is the part worth noticing: a Partial row
is a claim with an expiry date, and nothing re-reads it.

## One small thing the test double hid

`loadJobSummary`'s fixture did not model the two new relations, so the
loader read `undefined` and threw. Fixed in the fixture rather than with
`?? []` in the loader: a default there would hide a removed `select` and
report every job as never-closed-out, which is a confident wrong answer
rather than a crash.

No migration. 7,954 unit tests, typecheck and lint clean. **Nobody has
clicked it.**
