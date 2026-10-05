### The fix for forty useless notes silenced the one note that mattered (Cyrus)
`cyrus/sales-signals`

`601-forty-true-notes-nobody-needed.md` scoped the different-registrant note to pairs whose
NAMES bear on each other, because reporting every lead with a differing licence painted forty
true, useless notes onto one pasted row. That was the right problem. The gate was one
condition short, and an adversarial review of the four commits caught it.

**A lead holding this row's OWN licence came back in neither list.** Not offered, not noted,
nothing at all — whenever its *other* identifier disagreed and its name was unlike the row's:

```
row  { name: "Keystone Acoustical", licence: "884201", registration: "1000012345" }
lead { companyName: "Keystone Interiors", licenceNumber: "884201", registrationNumber: "1000099999" }

  before the scoping:  differentRegistrant [["registration","1000012345","1000099999"]]
  after  the scoping:  nothing
```

**That is the exact failure the licence match was built to end.** `sameCompany` opens with the
same contradiction test, so `importSubListing` refuses to merge that pair too — the server
declines, the screen says nothing, and the reviewer creates the duplicate by hand not knowing
the collision exists. Which is, word for word, what `601-the-licence-reaches-the-reviewer.md`
says it was written to stop. Review measured the reach: of 18,225 (row, lead) shapes, 8,136
changed behaviour, and **1,584 of those had an identifier agreeing exactly** — the regression.
The remaining 6,552 are the intended suppression.

The gate is two conditions now: pass over a contradicting lead only when the names do not bear
on each other **AND** neither identifier agrees. A shared licence is confusable however the two
names are spelled — that is the entire premise of keying identity on the licence — so a name
can never be the only thing that earns the note.

**One existing test looked like coverage of this and was coverage of its fixture's spelling.**
*"treats a shared licence with contradicting registrations as two registrants"* has a docstring
entirely about identifiers — *"the `||` in `identifiersContradict` is deliberate and this is
the case that proves it"* — and was written with the lead's name spelled identically to the
row's, so it passed through the NAME path. Changing one string, `"Keystone Acoustical"` →
`"Keystone Interiors"`, red it against the shipped code. It runs both spellings now, and the
unrelated one is the arm that means something.

**Four mutations, four killed:** the shipped one-condition gate reds the two new arms *and*
that repaired test; `AND`→`OR` reds eight, including every name-only contradiction case;
removing the gate entirely reds the four suppression cases; and an `identifierAgrees` that
reads only the licence reds the registration arm exactly. A bound case — neither identifier
agreeing, names unlike, must stay silent — stops the whole set being satisfied by reverting to
forty notes.

**AND THE FIX IS CHECKED THE WAY THE REGRESSION WAS CAUGHT, not by reading it.** Every fix
in this corner has turned out to have a scope error — the note itself, then the scoping of the
note — so the gate was swept exhaustively against `c0970e3a`'s pre-scoping version rather than
argued about. 9 company names (identical, suffix-only, unrelated, single-word, empty, `"&"`,
`"Inc."`) × 3 licences × 3 registrations, on both sides: **6,561 (row, lead) pairs**.

| | pairs |
| --- | --- |
| swept | 6,561 |
| behaviour differs from pre-scoping | 1,728 |
| …where an identifier agreed exactly | **0** |
| …where the names bore on each other | **0** |

So every remaining difference is the intended suppression and nothing else, which is the claim
the entry above could only assert. The sweep classifies each differing pair independently —
it re-asks the OLD function with both identifiers stripped to decide whether the names bear on
each other, rather than trusting the new code's own `nameEvidence` to say so.

### Three other things the same review found, all fixed here

**A dedupe line nothing could reach, justified by a false sentence.** `importSubListing` added
each written claim back into its per-lead set, because "two rows of a listing can produce the
same sentence for a lead when the claim does not quote their line". Every claim quotes its
line: all five claim-producing branches in `signals.ts` append `atLine`, and `chosen` filters
`parsed.rows`, whose line numbers are distinct. So two rows of one paste cannot produce a
byte-identical `(kind, claim)`. Review proved it dead by deleting it and watching the db suite
stay green. Gone rather than reinforced — the same call as the licence re-canonicalisation,
and the same reason: a guard that cannot change an outcome is a claim nobody can check. The
per-lead cache stays; it was never the dead part.

**The summary could over-report on a partial re-import.** `signalsProposed += fresh.length` is
correct, and changing it to `proposals.length` left all 51 db tests green, because nothing
exercised a partial overlap — some claims already on record from that `sourceUrl`, some new.
That shape is real: an agency reposts a corrected listing at the same URL with one field
changed. Changing the city alone moves exactly one of five claims, measured. The new case
asserts the count as an **identity against the database** (`signalsProposed === after -
before`) rather than a literal, with both bounds so it cannot pass on an all-or-nothing
re-import.

**A census that passed while the screen was backwards.** The `tooManyRows` gate census
asserted `toContain("tooManyRows")` — satisfied by the import line — and
`/disabled=\{[^}]*tooMany/`, which matches an **inverted** gate. Review showed three screens
slipping through: `tooMany === null`, `tooMany && false`, and `tooManyRows(0)` asked of a
constant. Each would disable the submit button for every normal paste with 476 unit tests,
four censuses and 52 db tests green. The census pins the argument and the sense of the
comparison now, and all three red it. Stated in its docstring rather than implied: a text
census still cannot prove the rendered button is disabled, because nothing renders this
component and the screen suite is happy-dom — that behaviour is verified in real Chromium, and
the server enforces the cap independently, so a backwards gate is a usability outage rather
than a data defect.

**And three prose sites that now asserted the opposite of the code.** The file header, a test
docstring, and the screen's own comment all said the contradicting lead is *"equally
deliberately not hidden"* — written when it always was. The screen's was the worst placed,
because the transposed-digit case it invokes is precisely what the over-scoping swallowed. All
three now describe the real rule and say why it is narrower than it was.

476 unit tests (from 472), 52 db tests (from 51).
