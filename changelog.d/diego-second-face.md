### What actually changed, in plain English (Diego)
`diego/second-face`

**A plan named by a word is a level, and a title wrapped onto two lines is
one title.** glen-hazel A-111's "Second Floor Plan" was found, scaled and
measured, then dropped as "the same floor drawn twice" because the level
parser read only digits and "First" and "Second" both parsed to nothing —
822 of the sheet's 1,843 ft of key. HACP A-5 captions four enlarged plans on
two lines each, and reading the last line alone gave four plans with no
level, one kept and three discarded — 353 of 396 ft. `planLevel` now reads
ordinal words, and `sheetViews` joins the line above a caption name when it
is in the same lettering and left-aligned with it. Both sheets keep every
plan now. Swept on every labelled sheet against main: 658 ft of real wall recovered for 231 ft of junk, all of it on those two sheets (glen-hazel 70.6% → 87.9% recall, HACP 83.7% → 87.9%), every other building byte-identical. That is 2.8 ft of real per foot of junk — just under the 3:1 bar, because the recovered drawings bring their own junk at 15 ft per 100, half the training average; Diego's call whether a dropped-plan fix is held to the tuning rule.

**Measured and not shipped:** "never offer a run alongside an
already-offered wall's face" loses real wall at every tolerance (0.2× to
1.2×), because what sits against a face on these sets is usually another
wall; the category was mostly casework edges two feet off a wall. Michigan
A3's 473 ft of unoffered key sits on the A-EXIST layer the product excludes
by design. Details in `NOTES.md`.
