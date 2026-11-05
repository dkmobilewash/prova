### The plan's printed tag is the wall code; the legend gives the family (Diego)
`diego/tag-suffix-codes`

Round 12's held-out score was 26% typed, and 21% of that typed correctly.
Most of the misses were near-misses:
- Hutto's legend draws C and D, and its plans tag C6, D6 and E6, where the
  number is the wood stud thickness, as the legend itself says.
- Joplin's legend draws A, and its plans tag A3.

A tag read in a symbol that is a legend family plus a size suffix
(`familyOf`) is now a code of its own. The family must end in a letter, and
the suffix is one or two digits with at most one letter. A tag the legend
spells exactly is never a variant.

Each variant gets a type (`withVariantTypes`): the family's id and assembly,
under the tag's full code. Both groupers take it, as does the stored-proposal
read-back, and the WALLS stage posts it on its own item ("C6 walls"). The
family's item is found by name first, so it never falls onto a variant's.

The legend read (`wall-legend.3`) now returns the legend's own suffix key,
verbatim. Hutto, Joplin and Baker all print one, and all three came back in
live reads with the codes unchanged. Rule 8 also says never to collapse
variants the legend draws as details of their own, such as S6A and S8A.

Measured on round 12's type keys (labels-snap-r12types-20261105T053332Z):
- Training, the three keyed sheets: correct-of-typed 72.5% → 83.5%,
  typed-correct 1,464 → 1,739 ft, wrong 556 → 343 ft. Joplin moved 63% → 79%;
  Baker and Green Bay are unchanged.
- Held-out, measure only, the three keyed sheets: typed 28.3% → 52.5%,
  correct-of-typed 20.5% → 49.5%. All 24 held-out sheets typed: 15.6% → 20.5%.

Not done: pricing a variant with its own stud size from the suffix key.
Joplin prints two keys, one for metal studs and one for CMU, so this needs a
careful parser.
