### Round 10's four held-out sets can never become training rows (Diego)
`diego/heldout-round10`

Thirteen plan sets were added on 2026-11-04. Diego approved the fourth session's split (coordination/survey-round10.md): Cattaraugus County courtroom renovations, Washington Village branch library, 4259 Fulton Rd (a restaurant, kept out of training by the restaurant rule) and the EH Hutto hotel are held out; the other nine train. They are added to `HELD_OUT_SETS` before any label exists for them, which is the only order in which holding out means anything. Matched on the real file names, including the on-disk spelling "cattauragus".

Check: `heldOutSets.test.ts` refuses all four by their real file names and with underscores, allows the nine training sets (including the other courthouse and library), and pins the list at 20. Breaking the Hutto entry turns two tests red.
