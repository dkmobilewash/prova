### Forms that closed onto stale data, and a census that knew one helper of two (Cyrus)
`cyrus/forms-settle-sweep`

**The census half (#679).** `ownerRefusalCensus.test.ts` exists to catch one
mistake: an action that declares `Promise<ActionResult>` and then refuses by
**throwing**, because production redacts a thrown Server Action message to a
digest — so a refusal that reads perfectly in `next dev` reaches a real user as
a dead button. It matched `assertOwner` and nothing else, in four hardcoded
places. `requireCapabilityForAction` (`lib/authz.ts`) throws too, and its own
docstring states the rule this census enforces. The convention was written down
twice, in the helper and in the census, and the census could only see half of
it. No action calls it today, so nothing was broken — but the next person to
reach for the capability-shaped helper in an `ActionResult` module is exactly
who the file is for, and the silence would have read as approval.

**The issue asked for eight helpers and it gets two, which is the judgement in
this change.** `shared.ts` throws a bare `Error` from seven more. Measured
against all 408 exported actions rather than argued: **43 call sites** in
`ActionResult` actions reach one outside any converting try/catch —
`assertJobInCompany` 23, `assertLineItemOnJob` 6, `assertEditableDirectly` 6,
`craftClassificationIdFromForm` 6, `phaseCodeIdFromForm` 2. Policing those here
would fail the build on 43 sites across two other lanes and assert a rule this
codebase deliberately does not hold — `shared.ts` says why in as many words:
they "answer a question about a record, not about a keystroke", and "converting
them is a separate decision with its own call sites to check".

The discriminator is **reachability by a legitimate user**. `assertOwner` and
`requireCapabilityForAction` refuse a person for who they ARE — a non-owner
pressing a button they can see, which is routine and is the whole reason
`ownerRefusal` exists. The record guards refuse a claim about a row, reachable
only by a forged id **or by a job deleted between page load and submit**. That
second case is real and does produce a digest, so it is recorded in the
census's header with the table and left open on #679 for Diego's lane, rather
than pretended away or quietly policed.

**So the scope is DERIVED, not listed.** A two-name literal would be the same
hardcoding that caused this with one more name. `permissionRefusalHelpers()`
derives the policed set — every exported helper in those two files that throws
a bare `Error` *and* whose predicate reads a role or capability — and the
literal is asserted to equal it, so a third role-throwing helper fails the
census instead of escaping it. The wider eight is asserted whole, so a new
bare-`Error` helper of either class cannot appear unclassified. `InputError` is
deliberately excluded: `runAction` converts that one to `actionFail(message)`,
which is the readable path, so an `InputError` thrower is not a defect and must
not be policed as one.

`shared.ts`'s own roll-call sentence is asserted against the derived set too,
because that prose is a second copy of a canonical list and a stale sentence
saying a capability is MISSING is the direction that stops people looking.

**Eight mutations, and the two that earn their place are the green one and the
one that caught me.** M6b is *supposed* to pass: the same defect with the wrap
check hardcoded back to `assertOwner` goes **green**, because the census sees
the wrapped `assertOwner` inside the try, concludes the action is fine, and
misses the unwrapped capability call outside it. That is the control proving
parameterising the wrap check — not adding a name to a list — is what catches
this.

And the roll-call check **was vacuous, caught by its own mutation**: it asked
whether the whole *file* contained each name, in a file where every one of them
is necessarily declared, so it was satisfied by the `export function` line and
deleting the roll-call left it green. It now isolates the comment by its
opening sentence and **asserts the isolation before reading anything out of
it**, so a reworded roll-call fails loudly instead of silently becoming an
empty haystack in which nothing can be missing. This repo's own rule, arriving
as a bug in the test written to enforce it.
