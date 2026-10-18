### The three-door test gets a scoreboard (Cyrus)
`cyrus/scoreboard`

`/sales/scoreboard` — what went out and what came back, today and per door
over 7/14/30 days, so the pay-app / certified-payroll / takeoff test can be
read while it runs instead of reconstructed from Smartlead afterwards.
Operator-owner gated like `/sales`; read-only; nothing stored. Every number
is derived at request time (`lib/outbound-scoreboard.ts`) from
`OutboundEvent`, `OutboundReply` and `SalesActivity` — the door is read off
the sequence SUBJECT a send or reply carries, and the agent's own
`OutboundReply.door` wins over it, since a person can correct that one on
`/sales/replies`. UNKNOWN is a row, not a number folded into a door.

Days are the viewer's calendar for instants (events, replies) and the ISO
date for `occurredOn`, which is already a date. The check that proves it:
an event at 03:30Z lands on the 15th in UTC and the 14th in Los Angeles,
asserted in `outbound-scoreboard.test.ts`, along with the three subjects and
their reply prefixes, a reply with no agent row still counting as a reply,
a zero-sent rate rendering as "—" rather than 0, and the kill line
undecided until 200 are out.

Two things the board says it cannot see rather than pretending: "want me
to" yeses and files received have no row anywhere, so both read n/a; the
kill line uses positive replies as the stand-in and says so. Letters are a
TODO row until `cyrus/letters` lands.
