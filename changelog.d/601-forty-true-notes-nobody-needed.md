### Forty true sentences nobody needed: the collision note fired on every unrelated firm (Cyrus)
`cyrus/sales-signals`

`601-the-licence-reaches-the-reviewer.md` added a note for the lead whose licence
*contradicts* a pasted row — the case where the names agree and the documents say two
registrants. It reported **every** lead whose licence merely differed.

Measured rather than reasoned about, which is the only reason it was caught: a company with
**40 licensed leads on file produced 40 amber notes on ONE pasted row.**

> "Unrelated Firm 07 is already a lead with licence 700207; this row prints 884201."

Every one of those is true. Every one is useless, because those are forty different
companies that this row was never going to be confused with. At the scale the feature is
built for — up to 60 leads an import, several imports — a 40-row paste would have rendered
thousands of amber lines and buried the one note that mattered inside them. The fix I had
just shipped for *hiding* a collision would have made the collisions unreadable instead.

A contradiction is now reported only when the NAME would otherwise have made that lead look
like a match, which is what the note's own wording already claimed it was for. An unrelated
firm whose licence simply differs is passed over in silence, and **that silence is correct**
— there is nothing to tell a reviewer about a company they were never going to attach to.

The name rule moved into a `nameEvidence` helper so the contradiction branch can consult it
before deciding, which also removed the duplicated word-subset logic.

**Three mutations, three killed, and the middle one is the point:**

| mutation | reds |
| --- | --- |
| report every differing licence again | the three new cases |
| never report a contradiction at all | the **four** older contradiction cases |
| the shorter/longer pair the wrong way round | three name cases, including the new similar-name one |

The second is why the new tests are not enough on their own: without those older cases, "say
nothing about 40 unrelated firms" is satisfied by a version that reports nothing ever, which
is the opposite defect and strictly worse, since it hides the collision a reviewer needs.
Both directions are pinned.

**Two numbers in this entry were wrong and are corrected here rather than left standing.**
That row said **six**, and six tests do go red — but only four of them pre-date this change;
the other two were added by this very commit, which is the opposite of the argument being
made. (A fifth test in the same describe calls `identifiersContradict` directly and stays
green, since the mutation is to the caller.) The conclusion survives on four; the number did
not.

And the fixture is 40 leads because that is the scale the defect was **noticed** at, not
because the assertion needs it: review re-ran the gate mutation with the fixture at 40, 3, 2
and 1 and got identical results every time, since `toEqual([])` fails on one stray note
exactly as on forty. This entry claimed "the number IS the test", which was a true statement
about how the bug was found dressed up as a false one about the test.

**AND THE FIX IN THIS ENTRY WAS ITSELF TOO BLUNT — see
`601-the-silence-that-swallowed-a-shared-licence.md`.** Scoping the note to "the name bears
on it" also silenced a lead holding this row's OWN licence whenever its other identifier
disagreed and its name was unlike. Read that entry before relying on this one.

One smaller thing fixed on the way. Extracting the helper first spread one word array and
then worked out which of the two was the shorter from its length and first word. That is
correct as it happens, and fragile for no reason: comparing an array against itself would
make `every` trivially true and invent a resemblance. They are picked as a pair now.

472 unit tests (from 468), 51 db tests unchanged, `leadMatch.ts` clean under `tsc`.
