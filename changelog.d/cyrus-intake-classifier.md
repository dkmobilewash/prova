### What actually changed, in plain English (Cyrus)
`cyrus/intake-classifier`

When a document lands in the inbox — a COI, a drawing revision, a returned
submittal — something has to guess what it is before a person confirms.
That guess is now a pure function, `apps/web/lib/intake/classify.ts`, with
no database, no upload and no screen attached to it. Storage and the intake
page are being built separately against the same contract.

It is on its own for one reason: it is the only part of intake where being
wrong is expensive, and the only part that can be tested exhaustively on a
laptop in a second. A misfiled photo is nothing. A misfiled certificate of
insurance is a compliance problem.

**The rule the whole module is built around: HIGH means unambiguous, not
"best guess available".** `scan_0042.pdf` comes back UNKNOWN at LOW
confidence, and that is the CORRECT answer — the product asks a person to
confirm, so an honest "I don't know" costs one glance, while a confident
wrong answer costs the feature its credibility and after the second one
nobody reads the guesses at all.

Three things are enforced by how it is built rather than by anyone
remembering:

- **the reason a contractor reads quotes text sliced out of their own
  input**, at the offsets the pattern matched — so it cannot describe
  evidence that is not there. "Filename contains 'COI' and '2027'.", never
  "AI determined";
- **when two families both fire, neither gets to stay HIGH.**
  `Pay App 4 waiver signed.pdf` is a pay application or a lien waiver and a
  person has to say which; `bond breaker submittal.pdf` is a submittal, but
  "bond" is a material term in this trade as often as an instrument, so the
  reason names both readings;
- **a job hint is a fragment of the filename or it is null** — never
  assembled, expanded or corrected.

**The tests are the deliverable as much as the code.** 57 realistic
filenames, each asserted for kind AND confidence, and the table's size is
asserted against a number written out once — a table that silently shrinks
fails instead of passing over a smaller set. On top of that, four honesty
properties (every HIGH names evidence; every quoted fragment is really in
the input; job and revision hints are really in the input; no reason talks
about itself), each run over the table plus 144 generated names nobody
hand-picked, and **each asserting a FLOOR on how many rows exercised it** —
otherwise weakening the classifier until nothing returns HIGH would make
"no HIGH lacks evidence" pass trivially, which is this repo's recurring
vacuous-check shape wearing a new hat.

Writing the table first caught three real defects before the code was
finished, which is the only reason to write it first:

1. `\b` does not match across an underscore, because `_` is a word
   character — so `waiver_final_signed(2).pdf` classified as UNKNOWN and
   `scan_0042.jpg` claimed HIGH confidence it was a site photo. Half of
   these files are named with underscores. Matching now runs against a copy
   with `_` replaced by a space, character for character so the two stay
   index-aligned, and the quote is still sliced out of the original.
2. A blank WH-347 payroll form carries `Form WH-347 (Rev. 12/2008)` in its
   footer — the FORM's revision date, printed on every copy ever filed —
   and reading revision markers out of body text turned a certified payroll
   into "Rev 12". Revision markers now come from the filename only, where a
   "Rev" is the sender telling you which revision they sent.
3. `WH-347` is letters-hyphen-digits exactly as `A-201` is, so the drawing
   sheet heuristic fired on certified payrolls and pay apps and dragged
   correct HIGH answers down to MEDIUM. Known form numbers are excluded
   from it by name.

Mutation-checked three ways, with the tests held fixed: making every HIGH
reason generic went red on five tests, removing the underscore fix went red
on two, and removing the two-families downgrade went red on three.

`sizeBytes` is in the contract and deliberately unused — there is no honest
signal in it, and inventing one would be exactly the over-claiming this
module exists to avoid.
