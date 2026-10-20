### The two tiles that read n/a now count something (Cyrus)
`cyrus/scoreboard-signals`

`/sales/scoreboard` shipped saying "want me to" yeses and files received had
no row anywhere. Now they do, and both are derived, not stored — the same
prefix trick the call buttons and the reply agent already use.

A call that ends in a yes to the free one is logged with a new disposition,
`WANTS_REPORT` ("Yes to the free one" on the button row). It counts as a
conversation AND as a yes, owes no follow-up date (the delivery is the
follow-up, logged by hand), and `callScoreboard()` returns it as
`wantsReport`. It was not already expressible: CONVERSATION says they
talked, MEETING_BOOKED says a time was set, and neither says they said yes
to the sample.

A prospect's files arriving is a NOTE whose summary is
`[FILES RECEIVED · <door>]`, written by `markFilesReceived(leadId, door)`
(operator-owner gated, ActionResult, in `lib/actions/replies.ts` — so the
existing `replies.*` Ask exclusion already covers it). The button sits on
the lead page under the call buttons and on each row of `/sales/replies`,
defaulting to the door the latest reply came through, with a select to
change it. The board attributes the file to the door in the tag, never to
the lead's reply door, so a pay-app prospect who sends a payroll run is
counted where the files actually landed.

The by-door table gains a Files column, and the kill line switches from
positive replies to files the moment one is logged, saying which it is
using. The Slack block carries both numbers.

Checks that prove it: `callScoreboard` with a WANTS_REPORT row counts one
more dial, connect and conversation and `wantsReport: 1`; the tally
attributes `[FILES RECEIVED · CERTIFIED_PAYROLL]` on a lead whose reply door
is PAY_APP to CERTIFIED_PAYROLL; an unknown door in the tag reads UNKNOWN; a
`[REPLY SENT · assistant]` note and a plain note are not files; and the page
rendered against those rows contains no "n/a".
