### The AI allowance becomes something you can actually sell (Cyrus)
`cyrus/ask-allowance-hard-stop`

C Stream is about to be sold at $399/month with "300 questions and 300
document pages, a hard stop, never an auto-billed overage" attached to it.
Before this, none of that promise was enforceable:

- **`askAllowance` failed open.** If the limit check could not run at all,
  it logged and answered the question anyway. That is the right call for a
  courtesy limit and #257 is why — a database one migration behind took the
  whole assistant down behind a sentence that named nothing, and the worst
  case of answering unbounded there is a slightly bigger bill that we pay.
  It stops being right the day the cap is something a customer has paid
  for, because then "answer unbounded when you cannot check" is an
  unmetered spend surface wearing a ceiling.
- **Nothing counted pages.** A 40-page scanned bid package and "what time
  is it" cost the same one unit, and the document is the most expensive
  single thing this product does.
- **Usage was recorded AFTER the money was spent**, and the write swallowed
  its own failure by design. A process that died mid-stream spent the money
  and wrote no row, so the next question was free.

**What is there now.** A company-scoped monthly allowance on its own table,
`AskAllowancePeriod` — 300 questions and 300 document pages per UTC calendar
month. The unit is CLAIMED before the model is called, not recorded after,
and the claim is one conditional `UPDATE … SET used = used + n WHERE used <=
cap - n`. Two questions arriving together for the last unit therefore cannot
both win: the second re-evaluates its WHERE against the first's committed row
and matches nothing. That is the #224 collision prevented by construction
rather than caught afterwards by a unique index, and it is proved against a
real Postgres 16 in `allowance.dbtest.ts` — two at once, and ten at once with
five left.

**The two ceilings now behave differently on purpose, and the code says so.**
`lib/ask/usage.ts` keeps its fail-open hourly and daily courtesy limits
unchanged; `lib/ask/allowance.ts` fails CLOSED, in the same way and for the
same reason `lib/outbound-email-limit.ts` already did. Both headers argue it
at length, and `allowance.test.ts` injects ONE database failure into both at
once and requires them to disagree about it — because a header is a claim and
that is the check.

**A ledger row, not a count of rows**, and the reason is CLAUDE.md's counter
section. Anything derived from surviving rows is reissued when a row is
deleted; a count also cannot reserve anything, since the row does not exist
until after the spend; and pages are not rows at all. The figures only
increment, rollover is a NEW row for the next month rather than a reset in
place (issue #148's shape), and it is deliberately not named `*Counter`
because it issues no numbers.

**Pages are counted for real.** A PDF's page objects are found in its own
bytes, and if they are not there — which is what Word and Acrobat produce,
PDF 1.5 object streams — every Flate stream is inflated with `node:zlib` and
searched again. No new dependency. A photo is one page; plain text and CSV
are charged by length. A PDF whose page tree genuinely cannot be read is
charged a flat 10 and SAYS SO on screen, rather than being silently charged
one, which is the cheap answer and the wrong one: a file we cannot read the
size of is the file most likely to be a big scan.

**A failed call is MARKED, never released.** Releasing the unit would make
the cap defeatable by anyone who could make a call fail — which is the whole
surface reserving up front exists to close — and the provider bills the
tokens of a stream that died halfway anyway. The marked figure appears on
/settings/assistant so an owner can ask a person for a credit. Nothing in
this app adjusts an allowance by itself and nothing bills for going over.

**What the person sees.** /settings/assistant now leads with what is left of
this month's questions and pages, when it resets, and an amber band once
either is down to a fifth — because a hard stop nobody could see coming is a
support call. At the stop the box says what ran out, gives the date it comes
back, says nothing has been or will be charged, and says who to ask. It is a
returned stream event, never a `throw`: production redacts a thrown Server
Action message to a digest, and a paying customer at the cap would get a dead
button instead of the sentence that tells them what to do.

**No Stripe, and no seam left unnamed.** `allowanceForCompany()` is the one
function a plan, a tier or a prepaid pack has to change; its comment says what
such a change would need and states the one thing it may not do — the product
promise is a hard stop, so the most a paid tier may do there is raise the
number somebody is told about, never charge them for passing it.

**The build caught what typecheck and lint could not.** `attachment.ts` is
imported by `AskPanel.tsx`, so it is client code, and `node:zlib` cannot be
bundled for a browser. Both checks were green; the build failed with an
import trace ending at AskPanel. The fetching half moved to
`attachmentLoad.ts` and the shared policy stayed put.

Mutation-tested, all three restored and green afterwards: make the monthly
cap fail open → 3 unit tests and 1 db test red; charge one unit per document
regardless of pages → red twice, once at the counter and once through the
stream; claim after the call instead of before → 4 red, the ordering
assertion reading `['courtesy', 'model', 'claim']` where it wants
`['courtesy', 'claim', 'model']`.

Migration `20260922210000_add_ask_allowance_period` — one table, its unique
index and its foreign key. Additive; preflight's destructive check does not
fire. It does not back-fill, and that is right rather than an omission:
an absent period row means "nothing claimed this month", which is exactly
true on the day this ships.

**Not done here, said plainly.** `uploadComplianceDocument` sends a whole
document to the model at $2.25-$4.50 a call and is still neither page-counted
nor allowance-bound; it is the next caller to bring under this ledger and it
wants its own PR.
