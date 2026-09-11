### An owner refusal the person cannot read is not a refusal — #166 (Diego)
`claude/prova-vercel-direct-url-hg1acx`

Production redacts a thrown Server Action message to a digest. An action
whose declared return type is `{ ok: false; error: string }` — however it
is spelled — has promised the caller a sentence it can render, and
`assertOwner` throws. So a non-owner clicking *push to QuickBooks* got a
digest, while every other refusal in the same function gave them a reason.

**#166 counted nine. It is eleven.** `loadQuickBooksAccounts` and
`reconcileQuickBooksInvoices` declare the same contract inline with a
payload — `Promise<{ ok: true; accounts: … } | { ok: false; error: string }>`
— and both already returned `{ ok: false, error: "QuickBooks isn't
connected." }` for the not-connected case while throwing for the owner
case. The issue's classifier and my first one both missed them because
they matched the type NAME rather than the contract.

`ownerRefusal(context, message)` returns the refusal or null.
`assertOwner` is untouched: it is still correct in the twenty actions that
make no legibility promise and throw anyway, and changing it would have
altered their behaviour for nothing. The return is narrowed to the failure
branch, which is load-bearing rather than pedantic — `{ ok: true }` is not
assignable to `{ ok: true; accounts }`, so a helper returning the whole
`ActionResult` could not be returned from the two inline ones at all.

The fifteen actions that already hand-wrap `assertOwner` in a local
`try`/`catch` are left alone. Their refusals do reach the person, so they
are not defects — and they sit in three other lanes.

**`ownerRefusalCensus.test.ts` matches on the contract, not the name**, so
the blind spot that hid those two cannot hide a twelfth.

**And the census shipped with that blind spot first.** It parses each
action's return type; `indexOf("{")` was used to find the body brace, but
a return type contains braces, so for exactly the two inline-typed actions
it landed inside the TYPE, truncated it before the `ok: false`, and pointed
the body at the wrong block. The guard reproduced the miss it was written
to catch. Its own size check caught it — 35 parsed `assertOwner` against 36
in the sources — and that number was nearly read as incidental. It scans by
angle-bracket depth now.

Four mutations, all re-run after that fix: revert a named-`ActionResult`
action (red), revert an inline-typed one (red), narrow the matcher to the
type name with the inline one reverted (**all green — #166's blind spot
demonstrated deliberately**), and break the function parser so it sees
nothing (2 red, both vacuity guards, while the main assertion passes
happily on an empty list).
