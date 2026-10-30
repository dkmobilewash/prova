### What actually changed, in plain English (Diego)
`diego/junk-rules`

**A dimension string and a grid line are set aside, not offered as walls.**
On the keys cleaned of existing walls, the biggest junk that is not an
existing wall is stacked dimension strings — two dimension lines a foot
apart with "99'-9 7/8"" written between them — and long line pairs across
the whole drawing. "Dimension text between the faces" had been priced
twice and lost, because a wall carries dimensions too; what a wall has and
a dimension string does not is partitions meeting it. So: two dimensions
written between the lines, or one with witness ticks across them, and at
most one run meeting them, is a dimension string; an axis-aligned pair
spanning 85% of every other run that at most one meets is a grid line, a
property line or a border. Priced on every offered run per building before
it was written (`realplan/zzJunkRules.eval.ts`, keyless) and swept on 54
sheets against main: 857 ft of junk removed for 77 ft of real lost on
training, no building worse by more than 23 ft; held-out delta −242 junk
for −139 real, reported as totals. Each set-aside carries its reason and is
one click to accept. The cleaned-keys junk census (`zzJunkKinds`) and the
pricing table are in `NOTES.md`.
