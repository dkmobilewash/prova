### A cold route's first server action needs more than ten seconds (Diego)

`diego/spine-flake`

Fixes #707. `estimating-spine.spec.ts:149` failed CI run `38002818860` on a
commit that touched nothing near it, then **passed on a re-run of the same SHA
with no change**. The assertion:

```
expect(getByText('Added W1 and W2.')).toBeVisible()   timeout 10000ms
```

in a test that took **10.9s** — so the expect spent essentially the whole test
waiting. It is the run's first hit of `/wall-types`, the describe sets
`retries: 0`, and `playwright.config.ts:97` says retries exist for exactly
*"a cold Next compile"*. The one safety net for this was switched off.

The cost is out of proportion: `mode: "serial"` means steps 4-11 are **skipped**
rather than run, so one timeout reads as nine broken estimating features until
somebody re-runs the same commit. It did exactly that on #706.

#### Only the timeout changes, and that is the point

Two wider fixes were considered and both are wrong here.

- **Accepting the action's refusal text too.** `addStarterWallTypes` reports
  only what it NEWLY added and declines once W1 and W2 exist, so tolerating
  *"You already have wall types tagged W1 and W2"* would cover a database that
  is not fresh. But `run.mjs` creates a throwaway one per run (`persistent:
  false`), and the one documented way round that — `E2E_DATABASE_URL` — already
  fails three lines earlier on `No wall types yet`. **That tolerance would be
  unreachable**, which is a line read and understood forever for nothing. (The
  same shape as the dead guard deleted from `sheetLevel.ts` in #705, found the
  same way — by asking whether the code could change an outcome.)
- **Dropping the message assertion** for the outcome check below it. That would
  stop checking the button says what it did.

The 30s comes out of the describe's own 180s budget rather than being a new
allowance: room for one cold compile, on the one assertion that waits on one.

#### Two wrong diagnoses before this one, recorded because they cost CI runs

- **`clerkId` collisions.** The failing log is full of
  `prisma.user.create() — Unique constraint failed on (clerkId)`, which looked
  like two specs racing to mint a user. It is the handled first-sign-in race in
  `lib/auth.ts`, whose loser re-reads what the winner created. **The passing
  re-run had MORE of them — 18 against 12**, and more Clerk retries too, 14
  against 6. A signal that is higher in the run that passed is not the cause.
- **A poisoned retry.** `addStarterWallTypes` not being re-runnable would make a
  second attempt impossible — except `test.describe.configure` sets `retries: 0`
  on line 53, so there is no second attempt. #707 was filed saying this and is
  corrected in its own comments.

Both were plausible, both were written up before being checked against the
passing run. The method that worked in the end was comparing the two logs
signal by signal rather than reading the failing one on its own.

#### What is still not known

Whether the message never appeared, appeared as the refusal, or the action was
simply still in flight at ten seconds. The log does not say. The fix does not
depend on it: a longer timeout is right for the third, harmless for the first
two, and the outcome assertion after the reload is unambiguous in every case.
