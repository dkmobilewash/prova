### The licence number becomes a field, so an imported lead can be rung (Cyrus)
`cyrus/sales-signals`

The §4104 reader already pulled a contractor licence number, a city, the
prime that filed the listing and the project off a pasted public listing.
`SalesLead` had nowhere to put any of it, so every one of those survived
import only as PROSE inside a signal's claim — a true sentence, correctly
sourced, and unjoinable.

That mattered for one of them in particular. A §4104 listing carries no
telephone number: it names a company, a city, a licence and a scope of work.
California's CSLB licence file is public and does carry a number for very
nearly every registrant — so the licence is the key between a lead nobody can
ring and a lead somebody can, and a number inside "Listed with licence C-9
884201 (line 6 of the listing)" is not something two tables can be joined on.
`lib/sub-listing/leadMatch.ts` asked for this column in its own header and
said it was the first thing to do next; this is it.

Five nullable columns on `SalesLead` — `licenceNumber`, `registrationNumber`,
`city`, `listedByGc`, `listedOnProject` — plus `@@index([companyId,
licenceNumber])`. Additive migration, no drop, no backfill, nothing read by
the deploy before it, so there is no expand-then-contract window here.

**The key's shape is MEASURED, and the first version of this got it wrong in
both directions.** A parallel pull of CSLB's own free bulk CSV counted 5,007
wall-and-ceiling firms across 25 counties: `LicenseNo` is a bare decimal
integer of **2 to 7 digits**, no prefix, no punctuation, and not one value of
5,007 (nor of a 32,423-row master sample) begins with a zero. Shortest `92`,
longest `1162318`. Phone coverage on that set is **99.92%** — 5,003 of 5,007 —
which is what makes the join worth having at all.

This file originally required six to eight digits, copied from `parse.ts`'s
pattern, and both ends were wrong for a KEY. **Eight digits can never match**,
so an eight-digit value is a guaranteed false capture — most likely a money or
quantity column that won the licence slot — and refusing it loses nothing.
**The six-digit floor drops real licences** (`91594`, `102`, `92`): that floor
is not wrong where it lives, it defends `parse.ts`'s column-INFERRED read where
*"a five-digit run is a ZIP code"*, which is a question about which column a
number came from and is already settled before anything reaches here.

**Two normalisations the real documents force**, and `lib/sales-licence.ts` is
the only place that does either. The **class prefix** goes: a contractor holds
one number under several classifications, so the framing row prints `C-9 884201`
and the plaster row `C-35 884201` for one man, `parse.ts`'s `licenceOnly`
deliberately keeps that prefix because it is reading what the document said, and
every fixture in this repo writes that form — a naive join would have missed
100% of them. **Leading zeros** go: the repo's own harvest of 26 real Caltrans
files records `061234` with the zero significant in the document, CSLB stores
none, and note which way the old floor failed — `061234` is six characters and
passed it while the same licence written `61234` did not.

A cell can also be the literal `na`, which is the DOCUMENT saying there is no
licence. `licenceKey` returns a NAMED reason — `NOT_RECORDED`, `TOO_LONG`,
`MORE_THAN_ONE`, `NOT_A_NUMBER`, `TOO_SHORT`, `BLANK` — so a reviewer is not
sent hunting for a number nobody printed, and so the box can tell someone who
pasted a ten-digit DIR registration what they have pasted. `importSubListing`'s
dedupe used to carry its own anchored copy of the digit rule, which is the #526
shape (a canonical rule with a hand-rolled duplicate beside it, where a test on
the first cannot see the second) — and worse, it meant the number deciding
IDENTITY and the number STORED came from two rules nothing compared.

**A row that joins a lead which already existed fills blanks and never
overwrites.** Proved both ways in one case against a real Postgres: a lead
holding a typed licence of `111222` keeps it when a listing printing `775504`
is attached to it, and gains the city, registration, GC and project it did not
have. Overwriting would move another company's licence onto a lead somebody
attached by hand — well-formed data that looks up as the wrong firm — and the
contradiction stays visible anyway, because the row's own LICENCE signal still
carries what it printed, with its source and line, in front of the person who
has to decide.

**The GC comes from the row first and the document second, and both halves are
needed.** A single-prime listing attributes every row to that prime; a
bid-summary page naming several refuses at the document level (five primes
name five drywall subs and only one is about to get the work) and attributes
per row instead. Reading only one source leaves one of those null — each
direction is a separate mutation and each one reds a different test.

On screen: `/sales/[id]` grows an "On the public register" card under *What we
know*, whose standing line says what the licence is FOR rather than rendering
a number under a bare heading — "No phone number on file. Licence 884201 is
the key a CSLB lookup joins on". A word and a colour, never a colour. The list
rows carry `Lic. 884201 · Fontana, CA · listed by Swinerton Builders`, and
nothing at all when a lead has none of it. The licence and the city are
typeable too, because an import can put the wrong number on a lead and a join
key nobody can correct looks up as somebody else for good; the three
provenance columns are not, and a test asserts the edit form leaves them
exactly as the import wrote them.

**A non-licence typed into that box is REFUSED, where the import stores null
for the same input.** The two paths disagreeing is the assertion rather than an
accident: on an import there is nobody to ask, and in a form the typist is the
one who can fix it — under a label promising the number a lookup will use. The
refusal is returned, never thrown, because production redacts a thrown Server
Action message to a digest and a dead button.

The checks: 28 unit cases on the two pure modules, 6 rendering the card through
happy-dom, and 12 new db cases against a scratch Postgres 16 with the migration
applied (that suite went 13 → 25). **31 mutations run and 31 killed**, each
measured width in the licence tests present because one of them kills a
plausible version of the rule. Two of the first attempts turned out to be bad
mutations rather than survivors — one a syntax error that dropped the suite
total from 23 to 12 (read the TOTAL before the colour, and the harness now
refuses any run whose total is not the baseline) and one that carried its own
guard and so changed no behaviour at all.

No CSLB file is fetched, scraped or imported, and no sentence anywhere claims a
phone number has been found. This makes the join possible; the join is its own
piece of work.

**Two facts about that file recorded in the schema and in both modules, so
nothing built on these columns implies otherwise.** It holds **no email
address** ("Email addresses are not provided", on all three CSLB pages), so a
licence is not a route to one. And it holds **no line type** — nothing says
whether a number is a desk line or a mobile — so a key that finds a telephone
number is not permission to dial it, and no wording on these screens reads as
though it were. Nothing here matches classification codes; if anything ever
does, the measurement says the strings are inconsistently hyphenated (`C-9` but
`C35` and `D50`, `C61/` dropped), so a filter written `C-35` or `C9` matches
nothing and goes green.
