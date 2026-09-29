### #548 fixed the dead end on the screen somebody was standing in, and left the other one (Diego)
`diego/job-hub-way-out`

**No schema change, no migration.** Found while trying to re-test #548 on a
phone, which is the only reason it was found at all.

**What was wrong.** A notification tap that launches the app from a killed
state leaves its destination alone on the navigation stack — no back
chevron, because there is genuinely nothing behind it, and no tab bar when
the screen lives outside `(tabs)`. #548 gave `/alerts` a Home button for
exactly that. There are **two** push destinations, not one:

```
push-target.ts:18   { target: "alerts" }  →  /alerts        ← #548 fixed this
push-target.ts:19   { jobId }             →  /job/<id>      ← nothing
```

`/job/[jobId].tsx` is outside `(tabs)`, had no `canGoBack()` check and no
`HeaderHomeButton`. Its own comment has said since it was written that *"a
notification or a link lands here without passing through"* the jobs list.
Nobody acted on that sentence, including whoever wrote it.

**And this is the destination more likely to be met.** The digest push is
gated by the milestone ledger — `dispatchKey` is `alertKey@rung` with **no
date in it**, so an alert fires once per rung over a document's whole life.
`assignCrewMember`'s push has no ledger at all and goes out every time
somebody is added to a job. So the unfixed screen was on the reliable push
and the fixed one was on the rationed push.

**How it was found, because the method is the point.** Not by reading the
code. #548's fix had never been seen on a phone, and re-triggering an alerts
push to test it turned out to be impossible — the rungs were spent and no
date resets them. Going looking for another way to produce a cold tap is
what surfaced the second destination. **An untestable fix sent somebody
hunting, and the hunt found a bigger bug than the one being tested.**

**The fix is #548's, character for character**, using `useRouter()` rather
than the `router` singleton this file already imports — deliberately, so the
two screens make the identical call and one tap on a phone answers for both.
Extracting the three lines into a shared component is the obvious next move
and is **not** done here: `/alerts`'s version is still device-unproven, and
refactoring the thing about to be tested means a failure would not say
whether the pattern or the refactor was wrong.

**What guards it, and this is worth more than the fix.**
`lib/push-destination-exit.test.ts` asks the question that generalises —
not *"is `/alerts` fixed"* but *"is every destination fixed"* — and derives
the set of destinations from `targetFromData` itself, so a third push target
extends the census with no edit to the test. It is CLAUDE.md's *"a guard
that a list is complete cannot notice a second list"* one turn further out
again: #548 was not even a guard, it was a fix applied to the one member of
the set that had been observed.

Both derivation failure modes are asserted, because only one of them looks
like a failure:

- **SIZE** — routes parsed must equal routes counted by a second expression
  sharing no regex with the first.
- **SCOPE** — every parsed route must resolve to a screen file that exists.
  A route whose file is not found is not a small set; it is absent from it.

**Comments are stripped before matching, and that is load-bearing.** The
comment added to `[jobId].tsx` explaining this defect quotes `canGoBack`, so
a raw-text census would pass a screen that merely *talks* about having an
exit. #185's shape, and this repo has now paid for it three times.

**Mutation-tested seven ways, and M4 is the row that earns the size
assertion:**

| | mutation | reds on |
| --- | --- | --- |
| ctl | nothing | green |
| M1 | fix removed from `/job` | "gives every destination a Home button" |
| M2 | fix present **only in a comment** | same test — stripping works |
| M3 | extractor blinded, code correct | SIZE + non-vacuous |
| **M4** | **bug present AND extractor blind** | **SIZE only — the Home test went blind** |
| M5 | screen file renamed away | SCOPE + Home button |
| M6 | `HeaderHomeButton.tsx` deleted | the component test |

In M4 the Home-button test **passes** while the bug is present, because it
iterates an empty set and nothing is ever unfixed in one. Only the
independent count catches it.

`screens/job-hub.test.tsx` is the behavioural half — stranded case plus a
NOT-stranded control, pinned in the same shape as `alerts.test.tsx` so the
two screens cannot drift about what a cold start means. It was mutation-
tested separately against M1 rather than assumed non-vacuous, and reds with
its own message. Its third assertion exists because the two interesting ones
would both still pass if the screen rendered nothing at all.

**Not claimed:** neither screen's fix has been seen on a device. Both ship
in the next TestFlight build, and the check is one tap — force-quit, tap an
assignment notification cold, confirm there is a way back to Home. That tap
now tests both destinations at once, and unlike the digest it can be
triggered on demand by assigning somebody to a job.
