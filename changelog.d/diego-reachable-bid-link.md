### The link was there, the gate was still on it (Diego)
`diego/reachable-bid-link`

Both of these were found by CLICKING the two features #618 and #619 shipped, in
the browser, on production. Every check in the repo was green on both.

**The capability was unreachable.** #619's whole point was that a bid can be
linked to a job *before* anybody knows whether it was won — a carried quote
reaches that job's estimate, and an addendum gets checked against its takeoff,
while the bid is still out. `linkBidToJob` dropped its `status !== "WON"` check
accordingly. The bids page kept rendering the control behind
`{bid.status === "WON" && …}`, so the only way to reach the action was to mark
the bid won first, which is the exact workflow the change existed to remove.
The tester hit it in one sentence: *"A bid that's still Invited can't be linked
to a job at all."*

**No census here could have seen it, and that is the transferable part.**
`reachable.test.ts` asks whether an action has a UI caller. `linkBidToJob` has
one. Whether that caller can be reached in the state that matters is a
different question, and nothing was asking it — CLAUDE.md's *"nothing is ever
missing from a question nobody is asking"*, arriving on the web app rather than
the phone. Worse, `page.test.ts` was actively asserting the gate: *"shows the
control on a WON bid and not on an open one"*, counting exactly one control
across a WON row and an INVITED row. True and right when written; stale the
moment the action changed, and then standing guard over the defect. It asks the
reachability question now, and its old number (1) is the mutation that reds it.

**Removing the gate needed one more thing than removing the gate.** `linked`
was derived entirely from `loadBidOutcomes`, which filters `status: "WON"` —
deliberately, so a lost or in-progress bid never enters the bid-versus-actual
comparison. So an un-won bid appears in no outcome map, and simply deleting the
gate would have rendered the "link" button on a bid that was *already linked*.
The page reads `wonJob` itself now; the link is its own fact. `outcome` is
nullable, and a linked-but-not-won bid says what is waiting — *"What the job
actually cost against what you bid appears here once this bid is marked won."*
— rather than showing a blank, because the comparison staying won-only is
correct and is a different question from the link.

The copy stopped saying "became", which was true only of a won bid: *"Link the
job this bid is for"*, *"Which job is this bid for?"*, *"This bid is for X"*.
A test asserts the word is absent from an un-won bid's row.

**And a dead sentence with three passing tests.** #618's
`missingIndirectsSentence` built *"This estimate carries nothing for Cleanup
and Dumpsters."* Nothing ever called it. `MissingIndirects.tsx` writes its own
sentence — the one on screen — and that one names no kinds, because the buttons
beneath it already name every missing kind, so a sentence listing them was the
same list twice.

It is deleted rather than wired up, for that reason. What is kept is the
property that mattered: *"never says the bid is wrong, and never says what to
do"* was being asserted against text no user could read, and now runs against
rendered output in `components/missingIndirects.test.tsx` — the panel had no
component test at all, which is the gap that let a documented sentence differ
from the rendered one. A property is only as good as the thing it is pointed
at.

Writing that test caught its own blunt edge, worth recording: the first version
forbade the bare word "required" and went red on *"they are not required"* —
the clause that makes the panel advisory in the first place. The assertion was
cruder than the property. It now requires every "required" to be negated.

`components/missingIndirectsCensus.test.ts` asks the other question — not "is
the sentence right" but **"is there a second one"**, the guard that survives
somebody inlining a copy. It strips comments (both surviving docstrings quote
the phrase, and #185 is where a comment quoting a pattern disarmed its own
census), asserts the size of the tree it walked, and NAMES the file it expects
rather than counting to one — a count of one stays green if the wording moves
into a module nobody renders, which is this defect exactly.

Three mutations, each red and each naming the offender: the WON gate restored
(two tests, one reading `expected 1 to be 2` — the old assertion's own number),
a second copy of the wording added (the census printed
`+ "lib/estimating/indirect-costs.ts"`), and the component made to render
nothing (4 of 5 red — the mutation that tells a real render from a mock).

One thing deliberately NOT changed. `add-indirect.ts` leaves `costCategory`
null when no catalog entry backs the kind, so the app warns *"1 line has no
cost type."* That warning is the system working: classification in this repo is
declared, never guessed, and auto-assigning a category would be the guess the
rule forbids. Rough on day one, since the catalog ships empty; a product
decision rather than a defect, and not one to fix by quietly picking a value.
