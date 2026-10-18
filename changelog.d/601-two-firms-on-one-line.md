### A labelled-column listing could be read and could never be imported

`readLabelledColumnsForm` emits one row per BIDDER COLUMN and stamps every one with
the slot's own `firstLine` — honestly, because the document really does print two
firms across one line. The screen posted the selection as LINE NUMBERS and the server
resolved it the same way, so it found more rows than keys, `chosen.length !==
unique.length` fired, and the whole paste was refused: *"the listing does not read the
same way now as it did on screen. Paste it again."* The reader is deterministic, so
re-pasting reproduces it exactly.

**That shape was unimportable, and the refusal named the one remedy that cannot
work.** It is the shape the labelled reader was written FOR — its own header says the
real documents print four columns. Measured against the repo's own fixtures:
`ALIGNED` parses to lines `[3,3]`, `RAGGED` to `[3,3,3,8,8]`, both refused at every
tick pattern.

Three quieter faults had one cause with it: `chosen[line]` and `attach[line]` ALIASED
across the columns of a slot, so one tick ticked two firms and one "Already a lead?"
applied to both — which is the harm `SubListingImport.tsx`'s own longest comment says
this feature exists to prevent — and `<li key={row.line}>` repeated a React key.

The selection travels as `rowKeysFor` keys now: `line.ordinal`, derived from the
reading, so two parses of one text agree on it exactly as much as they agreed on the
line, with uniqueness added. Deliberately not a field on `ListedSub`: identity belongs
to a reading, provenance to the row, and `line` is still what every claim quotes. The
field is renamed `lines` → `rows` so a page left open across a deploy gets a clear
refusal rather than a stale line resolved onto whichever row now sits there.

### And the dedupe deleted earlier on this branch is restored, because its premise was false

It was removed on the argument that "`chosen` is a filter over `parsed.rows`, whose
line numbers are distinct — so two rows of one paste cannot produce a byte-identical
`(kind, claim)`". They are not distinct. Two columns of one slot share a line, so
`atLine` does not separate them, and PROJECT and GC_RELATIONSHIP draw on nothing else
that differs per column — that reader sets `listedBy`, `amount` and `percentOfBid`
null on every row. Measured: 5 claims each, 2 byte-identical, under both prime
outcomes. Two such rows reach one lead whenever a reviewer points both at the same
existing lead, and `SalesLeadSignal` has no unique constraint, so the duplicates land
on a lead nothing in this product can delete.

The deletion was checked the right way and against the wrong corpus: the db suite
stayed green because no fixture in it has the shape. **"A guard that cannot fire
should go" still stands; what it needs is that the reason it cannot fire be something
somebody measured rather than remembered.**

### Three guards that could not see any of it

- **The collision test excluded exactly the colliding case.** It guarded with
  `first !== row.line`, and the only rows that can collide are the ones sharing a
  line. It counts collisions now and pins them as an exact set, so a third colliding
  kind fails rather than being absorbed, and a labelled-column form is in its corpus.
- **`GC_RELATIONSHIP`'s two AWARDED branches were unguarded anywhere in the repo.**
  The claim-line case only asked `"UNKNOWN"`; dropping `atLine` from either AWARDED
  branch left all 482 tests green. It walks `PRIME_OUTCOMES` now, and the control
  asserts both outcomes are REACHED — a kind count cannot see branch coverage within
  a kind, which is the hole they fell through.
- **The cap census passed six wrong screens and failed two right ones.** Both needles
  in a comment passed (and the commit that added them added a ten-line comment to that
  file); the gate moved onto the CANCEL button passed, the file having two
  `disabled={…}` sites; `tooMany !== null === false` passed as a superstring. Meanwhile
  hoisting the gate to a `const`, and renaming `included`, both FAILED — and a census
  that reds a correct screen is a census people delete. It parses the TSX now: comments
  are not nodes, it finds the submit button specifically, resolves a hoisted gate, and
  requires the cap to be asked of the same expression the button's own label counts, so
  a rename passes automatically.

### Verification

Five db cases on the new shape, in a form built per case so none inherits another's
leads: the premise (two firms, one line, two keys), that it imports at all, that ONE
column imports without the other, and that two rows on one lead write the shared
claims once. 58 db tests, from 54. 482 unit unchanged.

Mutations, all killed, each naming the case: `rowKeysFor` dropping the ordinal (3
red); the add-back removed again (the dedupe case); the server resolving by line
PREFIX — which survived every other case and is killed only by the one-column one; the
`attach:` key reverting to `row.line` (6 red). On the cap census, six wrong screens red
and both correct refactors green. On the claim line, all four `GC_RELATIONSHIP`
branches now red when `atLine` goes, where two of them previously survived the whole
suite.

Both defects were found by an adversarial review of the branch rather than by its own
tests, and the first thing done with each was to reproduce it against the repo's own
fixtures.
