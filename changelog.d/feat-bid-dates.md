### A logged bid can finally be corrected, and it carries the dates a bid desk lives by
`feat/bid-dates`

Addenda move bid dates constantly, and until now nothing could change a bid's due date or name once it was
logged — the only edit path wrote status and amount. So the Due-soon list and the MISSED / gone-cold flags
went wrong the first time a GC pushed a date a week, with no way to put them right. Each bid row on `/bids`
now has **Edit details & dates**: project name, trade, amount, notes and every date, saved in one action
(`updateBidInvitationDetails`). The GC and the status stay locked there — the GC is who invited you, and
status has its own form. There is no history table for bids, so a moved date is simply updated; the flags
need no second write because they are derived from `dueDate` at read time, never stored.

Four new nullable columns on `BidInvitation` (migration `20261023000000_bid_dates`, additive, no backfill):
`dueMinute`, `walkDate`, `walkMinute`, `rfiCutoffDate`. Due-soon rows read "Due Thu 2:00 PM, 10/29/2026",
and a job walk or RFI cutoff inside the next 7 days is flagged on the row.

**The time is minutes after midnight, on the clock the invitation names, and is not converted to the reader's
zone.** An invitation says "2:00 PM" and no zone; storing an instant would force a guess at write time and a
second one at read time, and they can disagree by hours on a deadline. Same representation as
`DelayEvent.startMinute`. The cost: a sub in another zone from the project sees the GC's clock, which is what
the GC wrote. Day granularity is unchanged for MISSED / COLD — the time does not decide those.

Checked by `bid-dates.dbtest.ts`: log a bid already past its date (MISSED, overdue, not in Due soon), edit the
date, and the same bid is in Due soon with the time, no longer overdue, and DUE_SOON; a SUBMITTED bid goes
COLD -> FINE on the same kind of edit. Nine mutations (window bounds, noon, time-without-day, dropping each
persisted column, the company scope, the create path) each turn at least one of the unit or db tests red.
