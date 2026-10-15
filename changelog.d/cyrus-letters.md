### One letter, to the firm the state says is doing certifieds this week (Cyrus)
`cyrus/letters`

CSLB publishes no email address for a licensee, but it publishes a mailing
address for every one of them — so the firm that filed certified payroll
last Friday can be written to on paper even when it cannot be emailed. This
is that arm of C Stream's outbound: for each tier-1 firm on
`/sales/public-works` (in market this week, derived from its DIR signals as
the page derives it), one physical letter to the address on its licence,
mailed through Lob.

The letter (`lib/letters/template.ts`) is the cold-email study's voice on
one page: the public fact first with its source named ("that's on the DIR's
certified payroll list"), the motive, a gift before the ask (a week of
timecards in, the finished certified payroll, the 347 and the fringe sheet
back by the end of the next day, no charge, nothing to install), a two-step
ask by text, signed by the founder, with the C Stream, Inc. address in the
footer. The study's words-to-avoid are a regex list the test holds the body
to. It refuses to render without a return address — the six `OUTBOUND_*`
values in `.env.example` — because a letter with none is illegal and
useless.

A row per letter (`PublicWorksLetter`, additive, not company-scoped, same
reasoning as the firm tables) is what stops a firm getting two letters for
the same filing: `signalFact` stores the sentence the letter opened with and
the queue skips a firm whose current fact already has a row. A new filing
is a new fact and may earn a new letter; nothing about eligibility is
stored. Sending is idempotent twice over — a SENT row is never selected
again, and every Lob call carries the row id as its `Idempotency-Key`, so a
call whose response was lost returns the original letter on retry rather
than mailing a second one. A `test_` Lob key renders and mails nothing; the
strip says which key it is holding.

Checks: `lib/letters/letters.test.ts` — fact first and source named,
forbidden words absent, footer present, refusal without a return address;
queue picks tier 1 only, skips the same fact and a firm with no address;
the Lob client's auth header, idempotency key and error sentence against a
fake fetch; send marks SENT/FAILED and never re-sends. NOT yet clicked
against a database: the strip, the preview disclosure and a real Lob test
key are the click-list for the PR.
