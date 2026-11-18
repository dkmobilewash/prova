### Walls go to deck: one press for the deck height (Diego, behind TAKEOFF_DECK_QUESTION)
`diego/deck-height-question`

Drawings rarely print a deck elevation: Round 28 asked four sets picked for printing one and got two
stated values. So when a job's walls go to deck or structure and no deck elevation is printed, the
review queue now asks once, first: "Walls go to deck: deck height?" The box is pre-filled with what
C-Stream read (the floor-to-floor most to-deck walls stand on, else the set's one bearing line, else
the company's usual height), and the source is shown under it. One press puts the answer on every
to-deck wall of the job and their board, and Undo puts back exactly what it replaced. The answer is
the person's own (not assumed). A deck the set prints is never asked, and walls that do not go to
deck (ceiling +6, a fixed height, a drawn ceiling rule) never take it.

It is kept as a plan read (`DECK_ANSWER` on each of the job's plans), so there is no migration.
OFF by default.

Checks: `heightsByCode.test.ts` (the chain takes the answer only on to-deck walls; the pre-fill
order); `wallHeightsAssign.dbtest.ts` (asked with the floor-to-floor pre-fill, the answer on both
walls and the board line, not asked again, Undo back to the read and the question back; not asked
on ceiling walls or a printed deck); `queueDeckQuestion.test.tsx` (first in the queue, pre-filled,
one press, Undo). A mutation that turns the chain's answer off reds the unit test and the db test.
Measured: zero-touch with `ZT_DECK_PRESS=1` answers the press with the key's to-deck height, on training.
