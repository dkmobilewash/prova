### The bid leaves the building

Step 9 of the estimating workflow ends "submit before the deadline", and the app
stopped one step short: the package could be assembled (#785) and **nothing sent
it.** Marking a bid Submitted was a dropdown with no date and no record of what
went out, so the question a GC's "we never got it" actually asks — what did we
send, to whom, and when — had no answer anywhere.

Now: build the package on the job's proposal page, then **Send it to <GC>**. One
confirm screen shows the recipient, the subject, the message, the attachment and
what the estimate check found; one press sends it from the company's own domain
and records it on the message log, where the provider's delivery events land.

This was the second of the three sub-tasks the workflow audit found missing.

### Attachments, which this app could not send at all

`packages/integrations/src/email.ts` posted exactly
`{ from, to, subject, text }`. No attachment field in the type, the payload or
the schema — so the first thing to build was the mailer.

The pattern was already here and ours: `apps/lien-waiver/lib/email.ts` has
base64-encoded attachments through the same provider. Both the encoding and its
**`fetcher` test seam** are copied from it.

**That module had no test at all.** Not a thin set — none. Every suite that
touches sending mocks it away, which proves the callers and says nothing about
the request that leaves the process. It has twelve now: the payload shape with
and without files, base64 decoded back to the same bytes, the refused-HTTP
branch, the accepted-but-no-id branch that stops a GC getting two copies, and
that an unconfigured install posts nothing at all.

### No schema change, and the package is not stored

The merge happens in the browser, so the bytes reach the server the way
`quoteRead.ts` already does it: a one-shot `bid-package` upload token (a Server
Action body is capped at 1 MB), then the action validates the URL, fetches,
attaches, and **deletes the blob in a `finally`**. Nothing is kept; the message
log is the record. The send links to the bid through `relatedType`/`relatedId`,
the polymorphic pair `messaging.prisma` provides, so nothing migrates.

### Decisions the codebase had already made

**It is not an Ask command, and cannot be.** `commands.ts` names "outward send
without a composer" as T5, *which has no member on purpose*. Unlike `send_email`
there is no composer to hand off to — the review **is** the confirm screen. The
exclusion says so and ends "Never a command", which
`commands.coverage.test.ts` requires.

**The address is never typed.** It is read off the bid's `Contact` and the people
recorded against it, a named `ContactPerson` ahead of the company inbox. The form
may choose among them; the action refuses anything else.

**The confirm names the GC**, in `PayApplications`' style — the party spelled out
beside the tick, explained on screen and **enforced on the server**.

**`deliverEmail` grew a third caller rather than a second copy.** Its comment said
there were "exactly two ways in" by design; that is now three, on the same terms,
and the comment says the number is not the property — every entry point either
asserts a capability *and* the rate cap, or takes no recipient at all.

### The estimate check finally runs before the send

Its switch is literally called **`checkerBeforeSend`** and the module opens
*"before a bid goes out"* — but it was triggered by the status flipping to
SUBMITTED, which is after the estimator says they already sent it. Its findings
are now read onto the confirm screen. A read only: the agent still advises and
writes nothing.

### Verified

Preflight's four gates green, **707 test files, 10,999 tests**, no production
schema touched.

**Thirteen mutations, all red** — but only after the suite was fixed, which is
the part worth recording.

**Seven of them were green on the first run, including the three worst:** the bid
marked SUBMITTED when the send had FAILED; the uploaded package never deleted,
leaving a public-readable PDF of a company's pricing in a store every tenant
shares; and `documentUrlProblem` skipped, so any URL could be fetched and mailed.
Also green: the confirm not required, an unrecorded address accepted, another
company's bid submitted, the rate cap never firing, and the attachment dropped.

They were green because **nothing executed the action's body.**
`action-capability-guards.test.ts` does run it — as a principal who is refused at
the first line, and as one who gets through to fail at the next — so the guards
*looked* covered while none of them had ever been reached. That is the "written,
documented, and never called" shape wearing a guard's clothes.
`lib/actions/bidSubmission.test.ts` now drives the body: twenty cases, including
that the blob is deleted on every path and **not** deleted before the setup check
refuses, since an install that cannot send should not destroy somebody's package
to say so.

### Four censuses caught things on the way, all correctly

- `commands.coverage.test.ts` refused to let the action exist without a decision
  about whether Ask may reach it.
- `action-capability-guards.test.ts` demanded the module be imported so the
  action is *executed* as a principal lacking the capability, not just read.
- `numericInputCensus` stopped a bare `Number()` over a form value — and the
  better answer was that the figure was never used: the page count already
  reaches the GC inside the body. Dead read, deleted.
- `spinnerCensus` caught an in-flight label with no spinner beside it.
