### A dropped wall tag still counts: a carried type stops at it, and thickness alone no longer settles the run beside it (wrong-of-typed 15.5% -> 13.9% with the legend read's recall on, 24.3% -> 23.0% off) (Diego)
`diego/tag-chain`

The second's C3b analysis left the chain's tag and note reading as the main source of wrong wall
types. A per-run dump of every tag claim on the training type keys showed the common cause. When
a printed tag sits too close to two runs to call, `tagByRun` drops it, which is right: it names
neither run. But the run beside it then took a code anyway, either a type carried along the wall
from a tag far away or "the only type that thick". Most of the wrong carried feet were exactly
that.

The rule uses the tag's existing reach (`TAG_REACH_FEET`, 4 ft), so there is no new number:
- **Carried types.** A carried type no longer crosses onto a run beside a dropped tag of another
  code (`contestedRuns`). `propagateTypes` already treats a wall between two disagreeing tags as
  a question; this extends that to the dropped tag.
- **Thickness.** Such a run is not settled by thickness alone. It goes to a group of its own,
  and the queue asks with both the thickness's type and the tag's.
- **U.N.O. notes are unchanged.** Stopping a note at a dropped tag was measured too, and cost
  Joplin 32 ft of correct to remove 8 ft of wrong.

Measured on the training type keys (labels after Round 22c, keyless legend, Round 23 held-out
sets never read). The pre-registered bar was wrong-of-typed down in both arms, with no set's
settled-correct down by more than 2 pts and 50 ft:

| `LEGEND_TEXT_RECALL` | wrong-of-typed | settled-correct |
| --- | --- | --- |
| on | 15.5% → 13.9% (1,090 → 950 ft) | 38.9% → 38.8% |
| off | 24.3% → 23.0% (1,875 → 1,744 ft) | 38.5% → 38.4% |

Settled-correct moved on only two sets: K-4 −12 ft and McAllen −3 ft. With the gate on, carried
wrong went 170 → 59 ft and thickness wrong 275 → 246.

Rejected in simulation, not shipped:
- splitting a run between two tags along it;
- splitting at differing leader ends;
- untyping exact claim ties.

Not chain causes, and left: UCCS's tag-variant feet are mostly runs that span walls of two types
on a sheet whose key types are approximate. Green Bay A3.1's 73 ft of "note" wrong is the type
table not reading the sibling sheet (A3.2) that the product's WALLS stage reads.

The check: `droppedTag.test.ts`, red without each part (the dropped tags reported, the carried
stop, the thickness group, the stage hand-off, the reach, the note exemption).
