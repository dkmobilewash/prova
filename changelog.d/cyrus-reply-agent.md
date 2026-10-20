### A prospect writes back and something answers — or asks Cyrus to (Cyrus)
`cyrus/reply-agent`

The reply half of the outbound machine. Smartlead's reply webhook already stored
the event and logged an activity; now `handleReply` runs after that commit, inside
a try/catch that can never fail the webhook (a classifier error that 500'd would
be a vendor retry and the same reply recorded twice).

**The model classifies; it never writes.** `classifyOutboundReply`
(`packages/integrations`, under the AI_AGENTS switch) returns a class, a door
(pay app / certified payroll / takeoff / unknown), a confidence and the facts a
reply can carry — a phone, "text me", a best time. Every sentence a prospect can
receive is a fixed template in `lib/replies/draft.ts`: the three intakes with their
fixed turnarounds, one paragraph per door, "I'll check back in <month>", "who
handles this?". `replies.test.ts` reads every template and fails on a price, a
job date, "no strings", "A-1-131" or "eCPR". Every message ends "— sent by C
Stream's assistant; Cyrus reads every reply" — the study's rule, and the one that
removes the §17941 intent element at zero cost.

**"Stop" is a regex, not a verdict.** stop / unsubscribe / remove me / take me
off / do not contact / opt out in the reply's own words (the quoted thread beneath
is cut first, or our own footer would suppress everyone) is STOP at confidence 1
before any model runs, and it suppresses the lead the way the unsubscribe link
does — `doNotContact`, `outboundStatus DEAD`, and the Smartlead block, now in
`lib/smartlead/block.ts` so both callers share one line.

**Who sends.** `decide()` auto-sends only INTERESTED / SEND_INFO / NOT_NOW at
≥0.8 confidence with a known door — and only while `REPLY_AGENT_AUTOSEND=true`,
which ships `false`, so the first week every draft waits on **/sales/replies**
(operator-owner, like /sales): the prospect's words, the reading, the draft in a
textarea, Approve & send / Dismiss / Mark stop. Out-of-office is dismissed;
hostile, questions and anything unclear always wait.

**Sending goes through Smartlead's reply-to-thread endpoint** so it leaves the
same mailbox as a reply, idempotent on `smartleadMessageId`. The docs disagree on
which id the webhook carries (`stats_id`, `email_stats_id`, `reply.message_id`,
`reply_message_id`), so `threadIds` reads all four and a payload with none is
queued with "no thread id — answer it from the inbox" rather than guessed at.

**Schema, additive:** `OutboundReply` (one per reply event, Cascade from the
event, Restrict on the lead) and three enums. A "text me at <number>" reply also
writes a `ConsentRecord` with the reply as its text and hash.

Not clicked: no Smartlead reply has arrived on any deployment yet, so the webhook
payload's thread-id spelling and the reply endpoint's response shape are both
read-from-docs rather than seen. The route stores the raw body, which is how the
first real one settles it.
