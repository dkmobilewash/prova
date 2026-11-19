### Key wall LF is the union of overlapping verdicts, never the sum

The zero-touch and scanned evals now pass `feetPerUnit` to `keyFromLabels`, turning on the
overlap fold the function already had: two accepted wall rows on the same geometry (one left by
an older finder version) count once in the key, never twice. Found by Chrome in Round 33 — the
#1225 restores put fresh verdicts beside older rows on six sheets — and measured at 3,327 LF of
double-counted key across 41 sheets once the fold ran everywhere (stem A-1.1 −378 ft, Joplin
A-101 −318, Topeka p74–76 −798, ELEVEN03 A4.B.1–3 −804). `keyFoldWiring.test.ts` pins both call
sites to the two-argument form, with comments stripped before matching and the parsed call count
pinned to the raw occurrence count; mutation-tested by restoring the one-argument call and
watching it go red. The check for the trap: a sheet whose key LF exceeds what the drawing holds
after a restore round is this entry, not a labelling error.
