### team_roster takes the gate of the strictest page it reads (Diego)
`claude/prova-ai-task-completion-96pjes`

#310 shipped a guard that checks every Ask read tool's declared `capability`
against the guard on every page its handler actually cites, and it found four
disagreements. Three were recorded as acceptable — a secondary `/cash-flow`
citation from a tool gated on a different billing capability, where the data
is gated by the declared capability and the cost is a citation the asker
cannot open. The fourth was left for a decision rather than fixed, because it
was an access question and not a cleanup. This is that decision.

`team_roster` declared `capability: null`, so it was offered to EVERY signed-in
member. Its comment gave the reason: `/team` is open, and "a roster of who
works here is not a tier". That is true of the roster and not of what the tool
returns — it also reports how many certifications are on file per person and
what is MISSING on them, summarised from `/certifications`, which
`MANAGE_FIELD` guards. One tool, two cited pages, and the gate had been set
from the gentler one because its author reasoned about the primary citation
and the secondary never came up.

THE RULE THAT FALLS OUT, and it is the general one worth keeping: a tool takes
the gate of the strictest page it reads from, not the page its author had in
mind. The guard exists precisely because that is impossible to hold in a
reviewer's head once a handler cites more than one page.

WHAT IT COSTS, named because it is a real loss rather than a tidy-up. The two
job functions that hold no `MANAGE_FIELD` — ESTIMATOR and ACCOUNTING — can no
longer ask who is on the books. OWNER, PROJECT_MANAGER, FIELD,
PAYROLL_COMPLIANCE and a member with no job function set all keep it. Dropping
the `/certifications` citation instead would have kept the tool open while it
carried on summarising a guarded page; that trade was declined.

THE BEHAVIOUR IS TESTED, not just the declaration. `commands.test.ts` already
held a census of what each tool declares, and a census restates an intention —
it cannot say who actually stops being offered the tool. A new test calls
`toolsFor` with each principal and asserts the field and the owner still get
it while estimating and accounting do not. It also pins the rule that a member
with NO job function keeps everything (`lib/permissions.ts` rule 2, "nobody
loses anything by this feature shipping"), so gating a tool never quietly
becomes the exception to that.

Four mutations, four caught, every file restored byte-identical by sha256sum:
leaving the now-obsolete exception entry in place fails the prune test naming
it ("they agree now"); reverting the capability to `null` fails in TWO places,
the citation guard and the census; gating it to the wrong capability
(`MANAGE_COMPLIANCE`) fails both the same way; and reverting the capability
with only the new behaviour test selected fails naming the estimator's offered
list. The last one matters most — it is the only one of the four that would
have caught a gate that was declared correctly and did not take effect.

The `.eval.ts` routing suites were NOT run: they make live model calls and
this environment has no `ANTHROPIC_API_KEY`. The harness throws "the eval did
not run. It is not a pass." rather than skipping, which is the right shape and
is why that is stated here instead of being quietly omitted. The eval CASE
tests, which assert every routing case's asker is actually offered the tool it
routes to, are ordinary unit tests and do pass — relevant here because two
cases route to `team_roster` and both use a FIELD asker, who keeps it.

No schema change, no migration.
