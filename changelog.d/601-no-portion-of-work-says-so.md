### A row that lost its portion of work said nothing, and one of them took its trade as its name (Cyrus)
`cyrus/sales-signals`

Public Contract Code §4104 requires a listing to state the portion of work each
subcontractor is listed for. It is the column that makes the document worth reading. A row
where none read is therefore a row this reader has **misaligned**, not a blank in the
document — and it arrived with `concerns: []`, which breaks this file's own rule that a
refusal is never silence.

Three shapes measured, all three silent before this:

| row | name read as | portion of work |
| --- | --- | --- |
| `C-9 991009 ⇥ Fontana, CA ⇥ Metal stud framing and drywall` | **the portion of work** | null |
| `Realname Drywall ⇥ Fontana, CA ⇥ C-9 991010` | correct | null |
| `Realname Drywall ⇥ Fontana, CA ⇥ C-9 991010 ⇥ Lath and cement plaster` | correct | correct |

**The first row is why this is worth a sentence.** `isNameCandidate` needs three letters
somewhere, so a row of nothing but a licence, a city and a portion of work has no
company-name cell to find — and the portion of work is the field that reads as one. The
lead would have been called *"Metal stud framing and drywall"*, and after the cross-import
licence merge two such rows would join each other on a trade description standing in as
the corroborating name.

**Found by review, and the review's severity was too high — measured, not argued.** With
the portion of work consumed as the name there is no trade, so `tradeScope` is null, and
`shouldInclude` is `explicit ?? row.tradeScope !== null` — the row arrives **UNTICKED**,
under a label reading "not one of our five trades". It cannot reach the database unnoticed.
What was missing was not a gate; it was a sentence. An unticked row with a plausible-looking
company name is a row somebody ticks.

**A concern, not a refusal, and the reason is one CLAUDE.md already records.** Every cheap
test for "this reads like a trade rather than a firm" also matches real companies —
`Acoustical Ceilings Inc` is a name — so refusing would drop a real prospect to avoid
printing a silly one, and a missed lead is invisible where a junk lead is one glance. The
reviewer gates every row on that screen, so naming the doubt beats withholding the row.

**The change also repaired a test that was keeping a known defect visible by accident.**
`"STILL loses the portion of work and the trade to the same field — an open defect"` says
the row is visible because it "arrives with a concern" — and that concern was about its
LICENCE column, nothing to do with the portion of work. The case beside it asserted
`concerns` had length exactly **1**. So the defect that test documents went out silent, and
was only noticeable because of an unrelated sentence. It now says so itself, and the
assertion names both.

457 unit tests, up from 454. Two mutations, both killed: dropping the concern reds exactly
the three cases written for it, and pushing it unconditionally reds eight including the
control — which is in the suite because without it the concern could be attached to every
row in the app and the two positive cases would still pass.

Verified that the screen renders it rather than assuming: `SubListingImport.tsx:469` maps
`row.concerns`, so this is not another sentence written for nobody.
