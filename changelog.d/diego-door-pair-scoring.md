### The door scorer matches a found double door to both leaves' key points (Diego)
`diego/door-pair-scoring`

Diego's ruling, 2026-11-16, logged as a pre-registration amendment before any line or exam number: the
key marks a double door as one point per leaf, so a found two-leaf pair is matched leaf by leaf
(`doorLabels`). A door row is real when any leaf matched; recall counts every key point a leaf took.
Applies to the training opening table and to the doors exam alike. Training (labels-snap-20261117T0637,
main + the dashed-swing join): matched key doors 396 -> 415 of 459 (86.3% -> 90.4%), false found doors
25 -> 25.
Check: `openingFeatures.test.ts` (a pair takes two points; two singles one each; one leaf keyed is real
and takes one; 3 mutations red).
