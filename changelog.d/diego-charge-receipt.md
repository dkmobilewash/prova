### "3 pages" was a sentence fragment pretending to be a receipt (Diego)
`diego/charge-receipt`

A production screenshot of the spec reader caught two words floating between a
paragraph and a Delete button: **"3 pages"**. That is what all three readers —
spec sections, GC addenda and compliance documents — had been telling a
subcontractor after spending part of a capped monthly allowance on their behalf.

`pageChargeNote` returned the bare clause `"3 pages"`, written to be dropped
INTO a sentence. One caller does exactly that — `documentSpend`'s over-ceiling
refusal reads *"this document is 84 pages and one upload can use at most 60…"* —
and every other caller rendered it AS the sentence. One helper doing two jobs,
with only one of them having a caller that supplied the surrounding words.

**What a sub needs at that moment, and nothing else.** They have just spent
something they are capped on, in the middle of pricing a bid. Three facts answer
every question they have:

1. **what this one cost** — the number they would check the meter against;
2. **which meter** — these ledgers are separate precisely so reading specs
   cannot silently eat the allowance for reading addenda, and a receipt that
   does not name the unit throws that away;
3. **what is left** — the only one that changes what they do next, because it
   is what tells them whether to read the next section now or wait.

So:

    3 pages charged · 1,797 of 1,800 spec pages left this month

One line, no jargon, and no instruction to go and look somewhere else. If they
want the month in full it is on Settings → Assistant, and the refusal sentence
already points there, because a refusal is where that matters.

**It speaks the way the refusal does, on purpose.** `stopSentence` says "there
are 12 of 1,800 left this month"; so does this. A sub who hits the cap one day
and reads a receipt the next should not have to learn two vocabularies for one
number — and "of 1,800" is what makes "1,797" mean anything to somebody who has
never seen their ceiling. The thousands separator is there for the same reason.

**The unreadable-PDF case now leads instead of trailing in brackets.** A PDF
whose page count cannot be read is charged a flat 10, and that is the one case
where the number is not what the document is — it is this app's floor for a file
it could not measure, and most likely a big scan. It belongs at the front of the
sentence where it cannot be skimmed past, not in a parenthesis after a figure the
reader has already accepted: *"Charged as 10 pages — this PDF's page count
couldn't be read, so it is charged at the flat rate · 1,790 of 1,800 spec pages
left this month."*

**`pageCountClause` is the old function under its real name**, kept for the one
caller that genuinely wants a fragment. Splitting them is what stops this
recurring: the receipt can now only be used as a receipt, because it demands the
meter it was charged against.

**The "left" figure is the one AFTER this charge**, checked rather than assumed —
all three read their counter back following the increment. The production
screenshot agrees: a 3-page read showed 1,797, and Settings → Assistant said
1,797.

Eight new tests on the receipt, including that it is **not** a fragment — the
defect restated as an assertion, since "renders as a fragment" is something no
type can catch and the only thing that caught it was somebody's eyes. The
compliance-upload test that pinned the old `"23 pages"` now pins the full line,
which is also end-to-end proof the document reader reports its own numbers
correctly: 23 charged, 277 of 300 left.

559 test files, 8,700 tests.
