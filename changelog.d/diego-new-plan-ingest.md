### Twelve new plan sets checked for labelling, without a database (Diego)
`diego/new-plan-ingest`

`NEW-SETS.md`'s checklist has three pass/fail items — vector not scan, a
scale a machine can read, at least one real floor plan — and the first two
had no instrument that ran without ingesting the set into a database first.
`lib/takeoff/realplan/setUsability.eval.ts` answers them from the PDF: per
page, path operators, segment count, text layer, the printed scale
`scaleFromPrinted` would accept and how many dimension strings the
dimension reader could vote on; per set, a verdict in the checklist's own
words. It never suggests typing a scale in.

Run over the twelve sets in `~/Claude Folder/takeoff/real-plans/new/`
(1,000 pages in about two minutes): all twelve vector, all twelve with a
readable scale somewhere. The floor-plan half is deliberately NOT in this
file — it needs `takeoffRank` and the glyph-height title reader, which live
with `realSheets.eval.ts` on `diego/takeoff-audit`, and a copy here would be
the second hand-rolled list this repo keeps paying for. The survey itself,
the seventeen sheets chosen and the four buildings held out, are recorded in
`~/Claude Folder/takeoff/sheets-to-label.md`, outside the tree, with the
drawings.
