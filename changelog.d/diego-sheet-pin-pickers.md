### Two of the three pin buttons could never work (Diego)
`diego/sheet-pin-pickers`

One migration, additive. Two pickers, one new action, and the census that would
have caught this.

**THE DEFECT, STATED PLAINLY.** The sheet screen rendered three buttons —
*Pin a photo*, *Pin a punch*, *Pin a note* — and `save()` sent `kind`, `x`, `y`
and, for a note, the text. `pinContentProblem` refuses a PHOTO pin with no
`mediaId` and a PUNCH pin with no `punchItemId`, and **nothing ever sent
either**. Two of the three buttons failed on every click, for as long as the
feature has existed, with typecheck, 9,000 tests, lint, a full production build
and the e2e journey all green — the journey never clicks them.

**WHAT THE CODE SAID TO BUILD, which is not what the half-built version
assumed.** The app had already solved this problem the other way round:

```
router.push(`/photos/${jobId}?punchListItemId=${item.id}`)
// "The camera screen attaches the photo to THIS item at the shutter."
```

The established idiom is *carry the context into the capture*, not *browse a
list afterwards*. So the web — where photos already exist — gets pickers, and
the phone (next) gets capture-in-place. A foreman at the wall does not have the
photo yet and will not scroll two hundred of them one-handed.

**AND THE ONE THAT IS WORTH MORE THAN BOTH PICKERS.** `PunchListItem.area` is
free text — *"Level 3 corridor"* — which is how a sub has always had to say
where something is. `createPunchItemAtPin` raises the item AND pins it in one
act, replacing that with a point on the contract drawing. The item carries
`causedByOthers`, `responsibleParty` and `backchargeId`, so an item that is
somebody else's fault, with a photo, at an exact spot, dated and named, is a
backcharge packet rather than an argument. That is the sub getting paid for
rework they did not cause.

It demands BOTH `MANAGE_JOBS` and `MANAGE_FIELD` rather than the friendlier
one, because it does both things.

**A punch item has ONE location.** Pinning one that is already pinned MOVES it.
Migration `20261006180000_sheet_pin_one_per_punch_item` adds
`@@unique([punchItemId])`; the read in `createSheetPin` only makes the common
case pleasant, and the index is the guarantee — the invoice-number collision
shape this repo has already paid for once.

Safe with no dedupe, derived rather than assumed: a PUNCH pin is refused
without a `punchItemId`, and the only caller never sent one, so **no punch pin
can exist to collide**. Photo and note pins hold NULL, and Postgres treats
NULLs as distinct.

| mutation | result |
| --- | --- |
| control | green |
| **`mediaId` never sent — the original bug** | **RED** |
| `punchItemId` never sent | **RED** |
| `note` never sent | **RED** |
| raise-and-pin split into two calls | **RED** |

**TWO GAPS THE MUTATIONS FOUND IN MY OWN TEST, both worth more than the fix.**

Removing the ACTION's `pinContentProblem` call left the **entire 9,000-test
suite green**. The screen sending the right fields is a convenience; a Server
Action answers whoever posts to it, so the action checking them is the actual
rule — and nothing guarded it. Now pinned.

Then the first version of that new assertion matched the whole FILE, and
removing the placement check from `createSheetPin` stayed green because
`createPunchItemAtPin` calls it too. **A rule enforced somewhere in a file is
not a rule enforced where it matters.** Scoped per action, both go red.

584 files / 9063 tests, typecheck, lint, a full production build and preflight
clean. Announced in `#prova-build` before the push, per the working agreement.
**Not clicked yet.**
