### Three assertions that said more than they checked

All three came out of an independent mutation audit of this branch's newest tests. None
is a product defect; all three are prose or a floor claiming more than the code behind
it does, which is the failure this repo pays for most often.

**A sum that cannot see the distribution it was credited with.** The 60-row case
asserts `signals === Σ lead.signals.length` under the comment *"every lead really did
get its own evidence, not one lead getting all of it"*. It cannot say that: write all
300 to the first lead and both sides count the same rows, so the sum passes. What the
sum UNIQUELY catches is a claim landing on a lead outside the listing's own set — 300
against 299, with every other assertion green — so it is a provenance check and is kept
as one, with the right comment. The distribution is now an EQUALITY across the sixty
leads rather than `> 0` each, derived from the first lead so a claim table of a different
shape does not fail it. Mutation: truncate the last row's claims by one and the sum,
`signalsProposed` and the old `> 0` all still pass while the equality reds naming the
lead — *"Scalefirm 60 Drywall holds 4 of 299"*.

**A 6,000-document fuzz control that six documents satisfied.** It asserted TOTALS
greater than zero, which is a floor of one document per bucket: replacing all but six of
the 6,000 with empty strings left the control and both property cases green, so the
corpus could have shrunk by three orders of magnitude with the file still claiming to
walk 6,000. The floors are RATES per document now, each roughly a quarter of what the
generator measures at, so a generator change does not red it but a path going unwalked
does. The same mutation now fails with the number in the message.

**A docstring that was false in the direction that stops people looking.** It said the
generator "includes names that normalise to nothing (`""`, `"   "`, `"&"`, `"Inc."`) and
asserts none of them becomes a row's name". 1,611 of the 22,714 generated rows are named
exactly `Inc.`, and the case is green over every one — `isNameCandidate` wants three
consecutive letters and `Inc` has them. What it asserts is that no row reaches the
screen with a BLANK name, which is narrower and still worth having. Whether `Inc.` alone
should be a lead is a question about `isNameCandidate`, not about the partition. The case
is also recorded as the weakest in that file: three mutations of the name path leave it
green because `fieldSpans` guarantees the property one layer down, so it is insurance
against a future reader rather than a live guard on this one.

**And the scope gap worth more than the three of them.** None of the 6,000 generated
documents reaches the numbered-box reader, the labelled-column reader or the generic form
refusal — censused, not assumed. Those are the only paths where `accountedFor` is
deliberately not the sum of the four buckets, so two of the file's properties are false by
construction there: it both fails to cover them and would red on correct code if the
generator produced one. That is the same blind spot the labelled-column import defect
lived in, found independently from the other direction on the same day. Recorded in the
header, with the note that covering it needs a different generator asserting a different
invariant.
