### A tab labelled "Waiting t…", and the guard that could not have caught it (Diego)
`diego/mobile-tab-labels`

**Phone only. No schema, no migration, no logic.** Found by looking at build 8
on a real phone, which is the only instrument that could have found it.

**THE BUG.** #581 gave the Outbox tab `title: t("nav.outbox")`, and that
string is **"Waiting to send"**. Five tabs across a phone is roughly 78pt
each at `typography.size.xs`, so the bar rendered **"Waiting t…"** — which
names nothing. A truncated word is worse than a short one.

**IT PASSED EVERYTHING.** `design-tokens`, `theme-contrast`, `theme-parity`
and `touch-targets` all police TOKENS, and every token here was correct. The
defect was the number of characters the correct token was asked to render.
happy-dom returns zeros from `getBoundingClientRect`, so nothing in this repo
can see a width — the same blindness that put a 1.35-point line height on
five screens. The #581 PR body listed "five tab labels at 375pt" as a claim a
phone would have to settle. It did, and the claim was wrong.

**The fix is a new key, not a shorter string.** `nav.outbox` is *correct* on
the Outbox screen's own large title, in the Settings section header and on
the Settings row — "Waiting to send" says exactly what the queue is. It is
only wrong in the bar. So the tab gets `nav.tab.outbox` ("Outbox" /
"Envíos") and everything else is untouched. **A tab label and a screen title
are different things**, and this is the proof.

Also: `settings.title` was still **"More"** from when that tab was a
catch-all, while the tab now carries a gear icon and the Outbox has moved
out of it. It is "Settings" / "Ajustes" now, on both the tab and the screen.

**AND THE JOB HUB LOST A FACT IT SHOULD NEVER HAVE HAD, also found by
looking.** The card above the grid carried two: "Scheduled" and "Punch
items". On a job with no dates it collapsed to the one row and read as a
stray box — and that number was **already on screen**, in the "Punch list"
tile eight points below it. A summary that repeats the thing it is sitting
next to is not a summary. Nothing here could have caught that either: the
duplication only exists once both are rendered together, which is a layout
fact.

So the card is one fact — when the job runs, which is the only thing about a
job the grid cannot express, since every tile there is a count. No dates now
means no card, which is better than a box containing a dash.

**THE GUARD, and it is honest about what it is.** `tab-label-width.test.ts`
caps a tab label at **8 characters in both languages** — a character count
standing in for a pixel width, exactly the trade `rowActionsCensus.test.ts`
makes for delete labels, and it says so in its own header. It cannot prove a
label fits. It can prove nobody puts a sentence in the bar again.

The ceiling is the longest label the app ACTUALLY uses ("Settings" /
"Ajustes", 8) rather than a round number, so it cannot quietly grow to admit
the next offender.

| mutation | census |
| --- | --- |
| ctl nothing changed | green |
| Outbox tab borrows `nav.outbox` again | **RED** |
| the short key is given a long string | **RED** |
| only the **es** label grows | **RED** |
| the `title:` pattern drifts (empty set) | **RED** |

The last two are the ones worth having. A Spanish-only regression is
invisible to anyone reading the English, and an extractor that stops matching
makes every assertion pass on an empty list — nothing is ever too long in a
set with nothing in it. So the key count is checked against a second
expression sharing no regex with the first (`<Tabs.Screen` openings), and
every key is asserted to RESOLVE in both tables, because `undefined` has no
length and passes silently.

Its own scope assertion caught a real mistake while it was being written: the
first version imported `{ strings }` and the module exports `EN`.
