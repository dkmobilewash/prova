### A pair of dashed lines is not a wall to build (Diego)

`diego/junk-kinds`

With #824's finder the misses on the training sheets are scattered, so this pass went
after junk, which is now the larger error. `zzJunkKinds.eval.ts` counts it on the product
path — what the app offers, scored against the labels — and only the CONFIRMED kind: feet
of an offered candidate on a `not-wall` verdict and on no real wall. 12,434 ft of it on
the 26 training label files, broken into kinds and priced before any rule was written:
every candidate's features (dashed faces, tees, dimension text between the faces) are
written out, so "junk removed per real foot lost" is a number before it is a change.

The rule that passed: a pair whose BOTH faces are dash patterns — several short pieces
with short regular gaps — is set aside by the triage beside the site-equipment rule,
named `dashed-faces` with its reason. It is the dashed edge of a canopy or mezzanine
above, a setback line beside the building, a demolished wall, a dashed grid line: the
pair test cannot tell them from faces once `oneFacePerLine` has joined the dashes.

Priced on the labels: 590 ft of confirmed junk for 33 ft of real wall, 18 to 1. Measured
on the 36-sheet sweep on top of #824: training extra −679 ft for missing +30, no sheet
worse by more than 21 ft; held-out, as a delta only, extra −14 for missing +30 on one
STEM wall. A 0.2 ft floor on the dash length was tried and rejected (it spared 9 ft of
real wall and kept 269 ft of junk). "One face dashed" is not a rule: 957 ft of real wall
has one, 2.2 to 1.

Two rules that did NOT pass and are recorded so nobody rebuilds them: dimension text
between the faces (the stacked dimension strings, 1,941 ft of junk) also sits inside
4,225 ft of real wall, 0.4 to 1 at best; a second candidate along a real wall (1,931 ft)
cannot be told from the wall it duplicates by thickness, length or being single, 0.3
to 1.

`dashedFaces.test.ts` pins the pattern test, both-faces-only, a door-broken face not
counting, and a dashed line on the far side not counting for this face.
