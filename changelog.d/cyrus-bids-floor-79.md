### `/bids`'s "total won value" stopped silently dropping unpriced wins (Cyrus)
`cyrus/bids-floor-79`

Issue #79, filed by Diego and picked up across the lane split since he
offered it. `/bids` computed its own `wonBids = bids.filter(b => b.status
=== "WON" && b.bidAmount != null)`, then rendered the sum as "$X in won
bids with a recorded amount" — a number that reads as a total and is
really a floor, with the qualifier doing all the honest work in six words
nobody reads. Worse: with EVERY won bid unpriced, `wonBids.length > 0`
was false and the whole line disappeared, so a company whose wins were
all unpriced saw no explanation at all, not even a wrong number.

Why the common case is the broken one: issue #133 (assessed below, not
fully fixed) established that the bid create form could not set an amount
at all — every `BidInvitation` starts life amount-less, so a bid marked
WON without a second pass through the row-edit form vanishes from the
total by construction.

THE FIX REUSES, RATHER THAN DUPLICATES, `/pipeline`'s already-proven
arithmetic. `lib/bid-pipeline.ts` had `valueWon`/`valueWonUnpriced` inside
`summariseGc`, gated on a `today` argument `/bids` has no use for (no
overdue/winRate on this page). Split the money half out into its own
export, `summariseWonValue`, that takes a bare `{status, bidAmount}[]`
and needs no date — `summariseGc` now calls it internally, so the two
pages compute the identical thing instead of two numbers that could
quietly disagree. `valueIsPartial`'s parameter type was narrowed from
`GcRecord` to `{valueWonUnpriced: number}` so it keeps working on both.

`/bids` now renders "at least $X in won bids — N won bids have no amount
recorded" when any won bid is unpriced (including all of them, where X is
$0 and the line still renders), and a plain "$X in won bids" — no floor
language — when every won bid is priced.

ISSUE #133, ASSESSED: the create form ("Log invitation") had no bidAmount
field, but `createBidInvitation`'s own action already read
`nullableDecimalFromForm(formData, "bidAmount")` and passed it straight
through to `createBidInvitationRecord` — the action layer was already
fully wired, its own comment just said (correctly, until now) that no
caller sent one. Adding the field to the form is therefore a pure UI
change: zero action code touched. Took it. Left status alone (still
defaults to INVITED) and left the Ask command `log_bid_invitation` alone
— it builds its "ready" card through `resolveLogBidInvitation`'s chip/
clarify machinery, and giving it a bid-amount field would mean parsing a
number back out of natural language for a field almost never filled in at
invitation time, which is a real addition, not a contained one. Updated
two now-stale comments that said the form never sends `bidAmount` (in
`lib/estimating/bid-invitation.ts` and `lib/ask/commands/bids.ts`) so the
code stops describing behavior it no longer has.

TESTED. There was no test on `/bids`'s total-won-value logic before this
PR — said so, fixed it. `app/(app)/bids/page.test.ts` renders the real
page against mocked `prisma.bidInvitation.findMany` rows (same pattern as
`cash-flow/page.test.ts`): a mixed priced/unpriced WON set asserts the
unpriced row is counted in the tally and the sum reads as a floor; an
all-unpriced set asserts the line still renders instead of disappearing;
an all-priced set asserts plain total language with no "at least"; a
no-WON set asserts no won-value line at all. `lib/bid-pipeline.test.ts`
gained direct tests on `summariseWonValue`, including one asserting it
agrees byte-for-byte with `summariseGc` on the same rows.

MUTATION TESTED. Reverted the page to the old buggy filter/render: the two
tests describing the bug (unpriced-counted, all-unpriced-still-renders)
went red for exactly the old wrong output (`"$50,000.00 in won bids with a
recorded amount"`, and the all-unpriced case rendering nothing). Restored,
reconfirmed green. Separately, inverted `summariseWonValue`'s unpriced
filter (`=== null` to `!== null`): 4 tests across both files went red
(1 in bid-pipeline.test.ts, 3 in page.test.ts, including the
`summariseGc`-agreement test). Restored, reconfirmed green. 2 mutations
requested, 2 mutations caught, both for the intended reason.

Full unit suite 343 files / 5647 tests green, typecheck 0 errors, lint 0
errors (pre-existing unrelated warnings only). `pnpm build` compiles and
typechecks clean, fails only on the documented `Missing publishableKey` /
`DATABASE_URL is not set` case — no `.env` in this worktree, matching
every other agent PR tonight. `./scripts/preflight.sh` fails at the same
build step for the same reason; test/lint/typecheck all passed inside it.
dbtest NOT run — no scratch Postgres this session, not claiming it
passes. No schema change, no migration.
