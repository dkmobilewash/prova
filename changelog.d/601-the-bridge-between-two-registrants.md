### A blank licence cell was a bridge between two companies the document kept apart (Cyrus)
`cyrus/sales-signals`

An adversarial review of the cross-import dedupe, run against a real Postgres rather than
read, found three defects. All three are the same oversight wearing three faces:
**`importedHere` recorded what a single ROW printed, and a row that merged into an entry
taught it nothing** — so the entry stayed as weak as the row that made it, forever.

`identifiersContradict` was never the problem. `alreadyImported` has called it first since
it was written. It was being asked about an entry that had not been told.

**One — a sibling row rode a weaker entry onto a lead it contradicts.** A row merging onto
a lead from an EARLIER import pushed its own identifiers, not that lead's. The lead held a
DIR registration this document never printed, so the entry recorded `registration: null`
— and the next row of the same paste, carrying a *different* registration, found no
contradiction, matched on spelling, and wrote another registrant's DIR number onto a lead
with real history. PROPOSED, well-formed, and about somebody else. This one is new with
the licence merge: before it, the only lead a row could reach without a human was one the
same paste had just created, whose columns were that row's own.

**Two — the rule was order-dependent, and the entry announcing it said "never".** Three
rows, one spelling, licences `blank, L1, L2`:

| row order | leads |
| --- | --- |
| `L1`, blank, `L2` | 2 — correct |
| blank, `L1`, `L2` | **1** — all three welded, both licences on one lead |

The blank row's entry never learned `L1`, so `L2` compared against a blank, contradicted
nothing, and matched on spelling. `601-one-licence-one-lead.md` asserted that two rows
carrying different licences are "never the same company however alike the names read".
That sentence was false when it was written; it is true now. The mechanism predates this
branch — what the branch added was the claim.

**Three — "…and N you already had" counted rows on one path and leads on the other.**
`leadsAttached` was two separate `+= 1`s: per row on the hand-attach path, per lead on the
licence path. Two rows landing on one lead reported two leads. It is a `Set` of lead ids
now, so the sentence is true however the paths are mixed.

The fix is `absorb(entry, row)` — fill the blanks, never overwrite, the same rule the lead
columns already follow — plus pushing the UNION of the row's identifiers and the held
lead's, and `leadHoldingThisLicence` handing back that lead's own identifiers rather than
just its id.

**AND THE REVIEW FOUND A TEST THAT COULD NOT FAIL**, which is worth more than any of the
three. *"Never merges two documents on the name alone"* used two documents printing
licences `884601` and `884602`. With the licences different,
`where: { licenceNumber: row.licence }` returns **no candidate at all**, so `sameCompany`
is never called once — the name-corroboration leg and `identifiersContradict` could both
be deleted and it stayed green. Demonstrated rather than argued: the same fixture with
names sharing nothing gave a byte-identical summary. It is now two arms with the names held
identical and only the licence varying, and its docstring says **which arm bites** — arm 1
— and why arm 2 cannot be made to, which is a fact about the code (two independent guards)
rather than a weakness in the test.

Six new db tests, 46 from 40. Four mutations, each reverting one half of the fix, each
redding exactly one test and nothing else: the entry not being taught (reds the
blank-first order arm), the push carrying the row alone (reds the sibling-bridge case), the
count going back to rows (reds the tally case), and the `{ id: "asc" }` tie-break removed
(reds the tie case).

**Two of those mutations survived first time, and both survivals were the test's fault.**
The tie-break case let both ids default — and `cuid()` is time-ordered, so the lower id was
also the row inserted first, which is roughly what Postgres hands back from a two-row heap
anyway. It passed for a reason unconnected to the clause it was written for. The ids are
explicit now and inserted in the WRONG order, so only the `orderBy` can produce the right
answer. The second survivor is arm 2 above, where the answer was to correct the docstring
rather than the test. CLAUDE.md's rule held both times: the question is never "is my guard
too weak" but "what else already handles the input I chose".

**Three things the review found that are NOT fixed here**, said plainly rather than left to
be rediscovered:

- **Re-importing the same document twice still duplicates its CLAIMS.** One lead, correctly
  — but three imports of one `sourceUrl` leave 15 PROPOSED signals over 5 distinct claims,
  each tripled, so the reviewer confirms the same sentence three times and the lead stays
  undeletable. Not a regression (those 15 were previously spread over three leads) and not
  covered by any test, because the existing case uses two different source URLs.
- **A nameless row takes its trade scope as its company name.** `parse.ts`'s
  `isNameCandidate` needs three letters, so a row of nothing but a licence, a city and a
  scope parses with `name: "Metal stud framing and drywall"`. That is a reader defect, not
  a dedupe one — but the licence key makes it newly consequential, because two such rows
  now merge across imports on a scope string standing in as the corroborating name.
- **`"leaves a row the reviewer attached by hand where they put it"` cannot fail under any
  behavioural mutation** of this code: `leadHoldingThisLicence` is only reached in the
  `else` of `if (attachTo)`, so the property is structural. It legitimately pins against a
  future re-ordering of those two branches; it proves nothing about the merge.

No schema change and no migration.
