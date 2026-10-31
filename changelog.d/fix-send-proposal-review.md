### Bid proposal send: four review findings fixed — stale documents, a forgeable "sent", the wrong day, and a duplicate after success (Cyrus)
`fix/send-proposal-review`

An independent review of `sendBidProposal` found four defects. All four are
fixed, and each fix is mutation-tested.

1. **Only the total was checked for staleness.** The email is rebuilt at send
   time, so an alternate, a unit price, an itemized line, the scope or a clause
   could change after the page loaded while the total stayed the same — and the
   GC would get figures nobody read. The composer now posts
   `proposalFingerprint(documentText)` (SHA-256 of the exact text it showed);
   the action compares it with the text it rebuilds and refuses with "This
   proposal changed since the page was opened… Reload the page".
2. **A forgeable "bid sent".** `sendOutboundEmail` took `relatedType` from its
   form, so any MANAGE_JOBS user could write `BID_INVITATION` and make the guide
   believe a bid had gone out. It now refuses the reserved types
   (`BID_INVITATION`, `BID_QUOTE`, `HELP_REQUEST` — which also skips the rate
   cap — and `ALERT_DIGEST`), compared trimmed and case-blind
   (`lib/outbound-related.ts`).
3. **"Sent <date>" used the UTC day.** A 6:30pm Pacific send read as the next
   day. The guide loaders now take the viewer's zone (`getJobGuide` /
   `getOpenJobGuides` default to `viewerTimeZone()`), and `proposalSentOn` is
   `todayInZone(zone, createdAt)`. `buildJobGuide` stays pure.
4. **A failure after the email had gone.** If the bid-log write after delivery
   threw, the person saw an error although the GC had the email, and a retry
   sent a duplicate. Once delivery succeeds the action returns `{ ok: true,
   note }` ("Sent. The bid log couldn't be updated — mark it Submitted by hand.
   Don't send it again."), and the composer shows it as sent. The writes are now
   conditional `updateMany`s: only an INVITED bid becomes SUBMITTED, and only a
   blank `bidAmount` is filled, so a WON or DECLINED — or a typed amount — set
   in the meantime is never overwritten.

Check: the database tests (`facts.dbtest.ts`, `proposal-send-query.dbtest.ts`)
now run against a local Postgres 16, 30 of 30 passing — including the ones the
first PR could not run.
