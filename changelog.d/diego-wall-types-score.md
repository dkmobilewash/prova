### The wall-type eval reads a stored legend the way #970 merges it, so its types can be scored against the typed answer keys (Diego)
`diego/wall-types-score`

`realplan/wallTypes.eval.ts` (the per-run wall-type measurement) now also
takes a `zzLegendReadAll` output as its legend: every stored proposal of the
read, lowest page first, first page to name a code winning — the rule
`legendFromProposal` uses after #970 — with each type's add-from-legend
thickness and the pages' U.N.O. notes. Each run in `runs.json` also says
whether it is hatched. The scoring against the hand-typed keys lives outside
the repo. Measurement only; nothing in the product changes.
