### What actually changed, in plain English (Diego)
`diego/legend-existing`

A sheet now says, in code, what it uses for walls that are not being built.
`existingMarks` reads a floor plan's own legend rows — "EXISTING WALL TO
REMAIN", "NEW WALL", "AREA NOT IN CONTRACT" — and samples the symbol drawn
beside each, so the finder can compare a run with THIS sheet's existing pen
instead of guessing from grey; it learns the sheet's "(E)" or "EX"
convention, and lists the N.I.C. / NO WORK / TO REMAIN labels with where they
sit. No model and no finder change: it is a pure function on the inputs the
detection already has, for the existing-wall set-aside being built next to
it. Measured on eighteen training sheets: five readable wall legends, and
the existing pen was dashed, black stipple or a thick fill — grey in none of
them, which is why grey alone was never going to be the rule.
