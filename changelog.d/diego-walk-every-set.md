### The flow walk on eight real sets: no app crash, and the two it could not finish were the walk's (Diego)
`diego/walk-every-set`

The no-AI new-customer walk now notes, after every step, any uncaught exception, console error, error
banner or blank page, and the error of a step it cannot finish. Run on eight plan sets: six reached a
sendable estimate, with no crash, console error, banner or blank page on any of the eight. The two that
stopped (Bluetooth office TI, USU ASPIRE) stopped at the scale step, and both times the app offered the
one press a person makes. The walk did not know "Use 1/8" (from 18 dimensions)" on the plan set, and in
the review queue it pressed a per-sheet button inside a closed list instead of "Use the printed scale on
all 6 sheets". With no action timeout, that press waited until the 25-minute hard limit. The walk now
presses both, and every click is bounded at 60 s. Test: `e2e/lib/walkScaleAnswers.test.ts`.
