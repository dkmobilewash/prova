### What actually changed, in plain English (Diego)
`diego/user-exclusions`

**Two tools let the estimator say which walls are not the job.** "Exclude like
this": click one found wall and every wall on that sheet drawn the same way is
set aside, with a count and one-click undo. "Work area": draw the area of work;
walls outside are set aside and walls across the edge are cut at it. Both are
per sheet and both reach the whole-set estimate, including walls already on the
job unless some are posted, in which case that sheet is left alone. They live in
a new table, `TakeoffSheetExclusion`, so they can never be summed as a quantity.
The list after Find now also applies the same set-asides as the estimate, which
it had not been doing. Simulated from the labels, training: a work-area box
removes 4,738 ft of junk for 1 ft of real at best, and clicks with undo remove
10,394 for 1,674; blind clicking loses real wall, so the count and undo matter.
