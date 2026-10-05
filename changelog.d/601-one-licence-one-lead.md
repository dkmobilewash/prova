### Importing the same listing twice made two leads, and neither could be deleted (Cyrus)
`cyrus/sales-signals`

`importSubListing` deduped **within one paste** and not at all **across pastes**. A GC
posts an addendum, somebody imports the revised listing, and the same subcontractor
becomes a second lead. Measured against a real Postgres rather than argued — three
imports of one listing:

> Three `SalesLead` rows, every one stamped `licenceNumber: "884201"`, every one holding
> five `PROPOSED` signals — and therefore **permanently undeletable**.

The undeletability is the expensive half and it is nobody's bug: `deleteSalesLead`
refuses while any child row exists, which is correct (CLAUDE.md's evidence-record rule),
and the import gives every new lead five signals to review. So the duplicate arrives
already holding the children that make it unremovable. The screen `/sales` exists to be
is a call list, and a call list that shows one company three times costs the caller three
calls to find out.

A row now merges onto an existing lead when it is the **same company**, which takes two
things rather than one:

```ts
const identified =
  (row.licence !== null && row.licence === known.licence) ||
  (row.registration !== null && row.registration === known.registration);
return identified && !!row.normalised && row.normalised === known.normalised;
```

**Both halves are load-bearing, and the mutation says which failure each one prevents.**
Dropping the name corroboration (`return identified;`) reds two named tests, one of them
*"will not merge on a licence the name does not corroborate"* — because two unrelated
fixture companies share `884201`, so an identifier-only match welds `Acme Lath Systems`
onto `Valley Interior Systems` and the caller phones one company about another's job.
`identifiersContradict` is the other direction: two rows that each carry a licence and
carry *different* ones are never the same company however alike the names read.

**A survivor caused code to be REMOVED rather than strengthened**, which is the move
CLAUDE.md's surviving-mutation entry asks for. A `spellingIsEnough` flag looked like it
guarded the name comparison; over 522 spelling-equal name pairs it could not be shown to
change a single outcome, because `normalised` already decides every one of them. A guard
that cannot alter a result is not a weak guard, it is a claim nobody can check — so it is
gone instead of reinforced.

Pre-existing duplicates are **not** cleaned up and the merge target among them is picked
deterministically — `orderBy: [{ createdAt: "asc" }, { id: "asc" }]`, with the `id` tie-break
there because Postgres `CURRENT_TIMESTAMP` is transaction-start, so every row written by
one `$transaction` ties on `createdAt` and `createdAt` alone would leave the choice to
whatever order the planner felt like. Merged leads are pushed onto `importedHere`, so a
second paste in the same session dedupes against them too rather than re-merging.

`listedByGc` is now written from `listedByGcFor(row, header)` — the row's own
`Listed by:` where it has one, the page header's prime otherwise — read out of the
existing reader rather than invented here.

40 db tests pass against a scratch Postgres (28 before). **`lib/actions/sales.ts` cannot
be typechecked in an agent container**: `@prova/db` and `next/cache` do not resolve, and
per CLAUDE.md's blindfold rule everything downstream of an unresolved import is `any`, so
a real type error in that file *cannot be emitted* locally. What was verified instead is
that the file's error count and shape are **byte-for-byte HEAD's** — same 2 unresolvable
imports, same 3 untyped `tx` parameters, 5 lines in a 22,778-line run that is sound
rather than vacuous. CI's Typecheck is the only instrument for it, and it is the one to
believe.

No schema change and no migration, so nothing to announce before the push.
