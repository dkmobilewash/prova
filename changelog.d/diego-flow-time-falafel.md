### The plan upload starts when the file is picked (Diego)
`diego/flow-time-falafel`

The Falafel Fresh TI flow, measured as a new customer with no AI (sign-up through a signing link,
every press including each review-queue press): **67 presses, $8,993.03**. By presses: the review
queue 27 (wall types 18, prices 8, opening it 1), sign-up 11, the trade pick 7, Send 7, creating the
job 4. By time: the queue (the walk re-opening it to be sure it is empty), Run takeoff (mostly the
walk waiting for a pairing bar on a set with no demolition plan), reading 19 sheets (17.6 s), sign-up,
and the walk's markup wait. Every type, price, scale and the GC's terms is a person's call, and
thickness preselection was ruled out on purpose (`byThickness`). The biggest press that decided
nothing: "Add a drawing" after the file was already picked. The upload now starts on the pick
(Resume keeps its own button): 67 → 66 presses, same scope and the same $8,993.03.

The flow walk also stopped counting each queue price as three presses (typing the cost and Price it
are two). Test: `components/takeoffPlanUploaderOnPick.test.tsx`.
