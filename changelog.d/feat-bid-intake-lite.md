### Paste a bid invitation, see the same job from another GC, and read the bid log (Cyrus)
`feat/bid-intake-lite`

A sub bidding ~250 jobs a year gets 15-20 invitations a day, and often the
same job from several GCs. Until now every invitation was typed by hand,
nothing said when two of them were the same job, and the figures he keeps in
his own spreadsheet (bids a month, average bid, win rate, average contract)
were not on any screen. Three changes, **no migration and no schema change**.
The project-level model (`BidProject`) waits for both founders.

**Paste the invitation.** "Log a bid" on /bids has a box for the GC's email
or a BuildingConnected or Dodge listing. The model reads it into the existing
form (GC, project, trade, due date, and the due time when it parses
unambiguously). Anything without a column (site address, the job walk as
printed, bonding, plan link) goes into the notes as labelled parts joined
by " · ". Nothing is saved until the person presses Log invitation.
It follows `quoteRead.ts`. The checks are code, not prompt: any value the
model returns that is not printed in the pasted text is dropped and named,
a due date with no printed year is left blank, the GC is matched only by
exact normalised name, and the trade comes from a word list per trade
(`lib/bid-invite-read.ts`). It runs behind the **Bid research** switch,
because a new `AiFeature` member is a Postgres enum value and so a
migration. It costs one assistant question from the monthly allowance and
is recorded as a `bid-research` usage row with `promptVersion` `bid-invite.1`.

**Same job from another GC.** This is deterministic and only displays a
warning. It shows on the form as you type and under each open bid on /bids.
The rules live in `lib/estimating/bid-invitation.ts` beside the existing
same-GC dedupe:
- it only compares open invitations from a different GC;
- due dates more than 30 days apart, or different numbers in the names
  ("Phase 1" against "Phase 2"), are never a match;
- the same street address, or the same name (two or more significant words),
  is a match;
- a similar name (60% of significant words shared) is a match only with due
  dates within 7 days or the same city.

The warning says why in words: "Same name and due date as Riverside Medical
from Acme Builders". It never merges or hides anything.

**Bid log on /pipeline.** This covers the last 12 months, this year, all
time, and month by month, all worked out on every read. A bid is an
invitation that was submitted, won or lost, and it counts in its due date's
month. Average bid leaves out bids with no amount. The win rate is
`summariseGc`'s won / (won + lost). Average contract uses the linked job's
line-item contract value on won bids only, so a lost bid's linked estimate
is never counted as a contract. Undated bids, unpriced bids, and wins with
no contract on file are counted and named. "% of average contract" is
deliberately left out, because it has two readings that give different
numbers.

Checks: 13 mutations on the matcher, 13 on the reading layer, 5 on the
action and 10 on the bid-log arithmetic were all killed. Two dbtests run
against scratch Postgres (`bid-log-query`, `bidInviteRead`), each
mutation-tested on its tenant scope.
