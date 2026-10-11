### The outbound machine gets a memory: suppression flag, status, raw vendor events, consent (Cyrus)
`cyrus/sales-signals`

The schema half of the email engine (announced in #prova-build 7 Oct, no objection in
three days), plus the first thing that writes to it. Entirely additive — five columns on
`SalesLead` with defaults, two new tables — so every existing lead reads unchanged.

**`SalesLead.doNotContact` is THE suppression flag, and the rule is that every tool reads
it.** The call log sets it on a DO_NOT_CALL disposition (same transaction as the activity,
so the tag and the flag cannot disagree), the webhook sets it on an unsubscribe or a
"Do Not Contact" category, the lead page and the call list show it, and the nightly push —
not built yet — will skip it. It carries its reason and the date it was asked for, and no
code clears it. The derived read off the latest CALL tag stays as the fallback for leads
asked before the column existed.

**`outboundStatus`** says where a lead is in the MACHINE (NEW → SEQUENCED → REPLIED /
CALLED / MEETING / DEAD), deliberately not `OpportunityStage`, which says where a DEAL is.

**`OutboundEvent` stores every vendor event VERBATIM, append-only, unique on the vendor's
id.** Smartlead's own documents disagree on the payload shape (three spellings of the
reply event, two of the timestamp, two authentication schemes) — `lib/smartlead-webhook.ts`
reads all of them, treats the timestamp as optional, and the route stores the raw body
before deriving anything, so the first real event settles the shape rather than being lost
to a guess. A replayed event is a 200 and nothing: the vendor retries anything that is not
a 200, and a reply recorded twice is a reply rate that is wrong.

**`/api/webhooks/outbound`** fails closed (503 without `SMARTLEAD_WEBHOOK_SECRET`),
accepts either the HMAC header or the body secret in constant time, attaches events to the
operator company and matches the lead by email. A reply becomes an EMAIL activity
`[REPLY · category] preview`; a bounce is recorded; an unknown event is recorded and
nothing else. 11 tests on the parser, verifier and event id.

**`ConsentRecord`** is the evidence row for the consent page that comes next: the exact
text shown, its hash and version, the phone, the tick, when and from where. Nothing may
place an automated call without a row here with `checked` true.

**Check:** the migration is 20261010200000_add_outbound_tracking; `prisma migrate status`
names it. Log a call as "Do not call" → the lead page banner reads "asked not to be
contacted (asked on a call)" and the call list row reads "Do not contact — open lead".
