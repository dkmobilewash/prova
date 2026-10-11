### The nightly push to Smartlead, and the way out of it (Cyrus)
`cyrus/sales-signals`

The two halves of cold email the schema was waiting for: something that SENDS leads to the
sequencer, and the link that lets anyone stop it with one click.

**The push.** `/api/cron/outbound-push` runs at 14:00 UTC (7am Pacific) and the owner's
**Push leads now** button on `/sales` does the same thing on demand — one runner
(`lib/smartlead/run.ts`), so the two cannot disagree. A lead goes only when it is NEW, has an
email, and is not marked do-not-contact; the button says how many did not go and why. The cap
(`OUTBOUND_DAILY_CAP`, default 50) is a rolling 24 hours counted from the PUSHED events across
both callers, so pressing the button after the cron ran does not double the day — sending past
the warm-up is how a domain gets burned. A pushed batch turns QUEUED in the same transaction
that records it, so a re-run picks up nothing it already sent; the event ids are
`push:<lead>:<campaign>` and written ON CONFLICT DO NOTHING rather than caught, because a
caught P2002 rolls back the whole batch's status writes, which is the one way to double-push.

**Smartlead's docs did not match the brief, and the code says so.** The limit is 400 leads a
call, not 100 (we send 100). The API reference documents the response as `added_count` /
`skipped_count`; the `upload_count` / `block_count` / `duplicate_count` shape appears on no
page read. Both spellings are read, and the raw response is stored on every PUSHED event — the
webhook's rule: the first real response settles the shape.

**It fails closed on FOUR settings, not two.** Without `OUTBOUND_TOKEN_SECRET` and
`NOTIFY_BASE_URL` the unsubscribe link cannot be built, and an email without a working opt-out
breaks CAN-SPAM on every send — so nothing is pushed. The panel names what is unset before
anyone clicks.

**`/unsubscribe/<token>`** is public, one button, nothing to type. The token is the lead id plus
an HMAC tag, checked in constant time; a bad one is a plain "This link isn't valid", never a 500,
and names no one. Confirming sets do-not-contact (reason, date), status DEAD, records an
UNSUBSCRIBED event, and best-effort adds the address to Smartlead's global block list — our flag
does not stop a sequence already running there. What the page shows is read back from the lead,
so a refresh or an old tab says "Done" truthfully.

Check: `lib/smartlead/push.test.ts` (each exclusion alone, the mapping, 250 leads → 100/100/50,
a 404 on batch two is a sentence that keeps batch one and never contains the key),
`lib/outbound-token.test.ts` (a tampered tag, a swapped id, another secret all fail).
