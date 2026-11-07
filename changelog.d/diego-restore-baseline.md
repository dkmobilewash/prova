### A saved answer key comes back onto its sheet, whatever order the review loads in

Chrome, 2026-11-07: Hutto A102 reopened with 0 of its 450 saved decisions; the
draft held only the finder's 86 automatic pre-rejections. The label file was
intact and `restoreSaved` restores 449 of them in Node — the restore never ran
in the browser. Its "is this review untouched?" guard counted every key in
`verdicts`, and every candidate is a key there ("unreviewed" included), so it was
counting candidates; and it took its baseline once, on the first review state,
which can come before the candidates do. Empty first, then 450 candidates, read
as "450 decisions since the sheet opened", and the restore stood down for good.

The rule is now `restoreGate`: only real decisions count (not "unreviewed"),
and the baseline is taken again whenever the candidate list changes, so the
pre-marks that come with the candidates are part of it. A decision a person
makes after that still stops the restore from overwriting them.

Also: `zzWhyUnmatched.eval.ts` listed `unmatched`, which is now a count; it
lists `carried`, the decisions kept but not shown.
