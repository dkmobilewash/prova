### The money writes on a job now refuse the people the tab already refuses (Cyrus)
`cyrus/action-capability-guards`

Thirty-five Server Actions behind the job tabs asserted no capability.
Every one of them scoped by company, so nothing was ever visible across
tenants — but WITHIN a company, the boundary was the page and only the
page. The Billing, Retainage and Estimate tabs withhold their content
behind `MANAGE_BILLING` / `VIEW_JOB_COSTS` by rendering a sentence instead
of a form. That stops a reader. A Server Action is a separate HTTP
endpoint with a stable id and it answers whoever posts to it, so it never
stopped a writer. Issue #383.

Each action now asserts the capability its own tab withholds — invoices,
payments, pay applications, retainage releases and terms, and the
QuickBooks pushes on `MANAGE_BILLING`; line items, cost entries, takeoffs,
estimate versions, marking a job contracted and the whole change-order
lifecycle on `VIEW_JOB_COSTS`. Nothing was invented: the capability is the
one the page already withholds on, and where an action is also reachable
from the Ask box (`log_payment`) it is the capability that command already
declared, so the two surfaces now agree instead of one being open. An
OWNER holds every capability by construction and is unaffected; that is
asserted per action, not assumed.

**The check that should have caught all of this was green the whole time,
and that is the more important half of this change.**
`lib/action-capability-guards.test.ts` derives which actions must assert a
capability from the pages that reach them — a good design, and this repo's
answer to hand-written lists that cannot notice an omission. But it only
knew one way for a page to refuse: `requireCapability` + `<NoAccess>`, which
withholds the ROUTE. It folded "every door refuses nobody at the route
level" into the same `null` as "the doors disagree", so an action whose only
door was a soft-withholding tab contributed no iteration at all and could
never appear in the set being checked. The same family as every other scar
in CLAUDE.md where a check answered a question nobody asked.

It reads a soft gate now, and it is protected against the way that fix
could itself go quiet. The pages that withhold anything are counted by a
literal that cannot drift with the extraction patterns, and the
classification must account for exactly that many — so a pattern that
matches nothing fails with both numbers on screen instead of shrinking the
set and passing every downstream "nothing was found to be wrong".
`lib/scratch-cleanup-order.test.ts` paid for that lesson first. Shown red
before the fix: 49 failing cases naming all 35 actions. 8 mutations
requested, 8 caught by the intended test, including both vacuity mutations
and one that softens a page's own gate to prove the hand-written
expectation table catches a derivation that changes its mind.

**One absence is deliberate and on record rather than defaulted.**
`draftChangeOrderFromDelay` stays open: its only door is the Field reports
tab, which withholds nothing, the foreman who logged the delay is the
person who should draft from it, and nothing before APPROVED touches a line
item — every step that moves a contract value is gated above it.

**What this does not close, stated precisely.** The writes behind the
Overview and Crew tabs (crew assignment, job schedule, contract documents
and signature links, time entries, dispatch slips) are untouched: those
pages withhold two different capabilities section by section, so which one
each action answers to is a per-section judgement rather than something to
read off the file. `sendOutboundEmail` is also untouched, and the reason is
worth recording because it is not obvious: the capability derivation gives
`MANAGE_JOBS` (the `send_email` Ask command already declares it), but
`lib/actions/help.ts` calls that same action for the in-app "Ask us" form,
so gating it would silently stop ACCOUNTING and PAYROLL_COMPLIANCE from
asking for help. It wants the public action split from the internal
helper, which is a change to that feature and not to this one.
