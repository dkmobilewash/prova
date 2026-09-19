### Sending email now answers to a capability and a ceiling (Diego)
`claude/prova-contractor-os-e3f0iz` — issue #352, item 1

`sendOutboundEmail` had no capability check and no limit of any kind. Any
signed-in member of any company could send unlimited arbitrary email from
our shared sending domain, and the only thing that had ever bounded it was
that the only accounts were the two people building this.

`/pilot` (#349) ended that. It is a public signup link, so the question
stopped being "would one of us abuse this" and became "what does the first
stranger who wants a free mailer do with it". One spammy tester earns the
domain a spam reputation, and every other contractor's mail inherits it.
Deliverability is slow and miserable to win back.

**The ceiling is the control, not the capability gate, and the reason is
worth knowing before you read the diff.** A person who signs up through
`/pilot` gets a brand new company with `role: "OWNER"` (`lib/auth.ts:202`),
and rule 1 of `capabilitiesFor` is that an OWNER holds every capability,
always. So no capability check can touch the pilot case at all. The gate is
defence in depth for members inside an EXISTING company; `emailAllowance`
is the only thing standing between a stranger and the domain. Reading the
gate as the fix would be reading the wrong half.

**No migration.** The counts come from the `OutboundMessage` rows the send
path already writes before it calls the provider — 20 per person per hour,
100 per company per day. No new table, and no second number that can
disagree with the log.

**It fails CLOSED, which is a deliberate divergence from `askAllowance`**
two files away, so the argument is written down rather than left to be
discovered: an unbounded Ask costs us model spend, and unbounded mail from
a shared domain costs every customer their deliverability, which cannot be
refunded. The cost of the divergence is near zero anyway — this counts the
very table the send writes to three lines later, so a database that cannot
count those rows could not have recorded the send either.

**Help requests keep working for everyone, and that is not a courtesy.**
Gating the shared send would have taken "Help → Ask a person" away from
ACCOUNTING and PAYROLL_COMPLIANCE, the two job functions without
MANAGE_JOBS — so the people most likely to hit a permissions wall would
have been the only ones unable to report it. `sendSupportEmail` skips both
guards and is safe by construction rather than by trust: it is an exported
Server Action, so it reads the destination from configuration itself and
overwrites whatever was posted. The only address it can reach is our own
support inbox, whoever calls it.

**The specific check.** `action-capability-guards.test.ts` never covered
this and still does not: it requires a guard only on actions reachable from
a GUARDED page, and `/messages` has no `ROUTE_CAPABILITY` entry, so that
suite was green throughout the hole and would stay green if the gate were
removed. The two new files are what fails instead — `outbound-email.test.ts`
asserts the queries the counter actually issues rather than only its
verdict, because `{ ok: true }` is also what a `where` clause matching
nothing returns.

Mutation-tested, 7 requested and 7 returned red: the capability gate
removed, the ceiling's refusal ignored, `sendSupportEmail` honouring a
posted `toAddress`, `sendSupportEmail` consulting the ceiling, the
help-request exclusion dropped from the counts, the hourly window widened
to a day, and fail-closed flipped to fail-open.

Not fixed here, and still open on #352: invite capture at first sign-in,
and the `inviteTeamMember` existence oracle.
