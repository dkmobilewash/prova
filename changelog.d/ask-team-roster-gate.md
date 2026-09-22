### The team_roster gate, proved to take effect (Diego)
`claude/prova-ai-task-completion-96pjes`

THIS ENTRY IS MOSTLY A CORRECTION OF ITS OWN FIRST DRAFT, and the shape is
worth more than the change.

#310's citation guard found four capability-vs-citation disagreements and
recorded three as acceptable. The fourth was left open as an access decision:
`team_roster` declared `capability: null`, so it was offered to every
signed-in member, while reporting certifications on file and what is missing
on them — summarised from `/certifications`, which `MANAGE_FIELD` guards.
Diego's call was to gate the tool, and this branch did that.

**Another session made the same change and merged it first.** By the time
this branch was rebased, main already carried `capability: "MANAGE_FIELD"`,
the exception entry already deleted from `CITATION_CAPABILITY_GAPS`, and the
census in `commands.test.ts` already updated — with the same reasoning,
independently arrived at. The conflict was resolved by taking main's side on
all three, because it is there and it is right; keeping this branch's wording
would have been a diff for nothing.

WHAT WAS ACTUALLY MISSING, and it is the only thing that survives here: a
test that the gate TAKES EFFECT. Both versions updated the census, which
records what each tool DECLARES. A census restates an intention. It cannot
say who actually stops being offered the tool — and a capability declared
correctly but not filtered on would pass every check on main today.

So `commands.test.ts` gains a test that calls `toolsFor` with each principal
and asserts the field and the owner still get `team_roster` while estimating
and accounting do not. It also pins the thing most likely to be broken
silently by the NEXT gate somebody adds: a member with no job function set
keeps everything, which is `lib/permissions.ts` rule 2 — "nobody loses
anything by this feature shipping". Gating a tool must never quietly become
the exception to that.

Mutation-tested: reverting the capability to `null` with only this test
selected fails naming the estimator's offered list. That is the mutation the
census cannot catch, which is the whole reason the test exists.

The duplication itself is the second lesson, and it is the same one #279 paid
for in this repo three weeks ago: two sessions can be working the same
finding at once, and a PR that sits open while its fix lands elsewhere costs
a rebase and a re-read. Check main before resolving, not after.

No schema change, no migration.
