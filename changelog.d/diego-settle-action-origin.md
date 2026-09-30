### `settleAction` waited for the wrong POST, and four specs rolled dice on it (Diego)
`diego/settle-action-origin`

**No schema change, no migration.** Two lines of behaviour and a test that
could not previously exist.

**What was wrong.** `e2e/lib/journey.ts`'s `settleAction` is the helper that
makes "write, reload, read it back" honest — it waits for a Server Action's
POST to answer before the caller navigates. Its predicate was:

```ts
page.waitForResponse((response) => response.request().method() === "POST")
```

**Any POST.** A signed-in page is never quiet — Clerk posts to its own host
throughout a session — so the wait returned before OUR action had answered,
`page.reload()` navigated out from under the write, and the reloaded page
truthfully still showed the old value. **The failure it produced looked
exactly like a product bug**, which is why it was chased as one four times.

**It bit `journey`, `estimating-spine`, `shoot-rehearsal` and `bid-desk`** —
the four files that call it, 29 call sites between them. `bid-desk.spec.ts`
carries a comment at line 119 saying *"`settleAction` waits for each action's
answer — every reload below reads"*, which was false about the helper as
written, sitting in the file most exposed to it.

**The tightest evidence was a RE-RUN, and it is worth keeping as the shape of
proof for a race.** On 2026-09-29 `estimating-spine:361` failed on a PR whose
entire diff was `apps/mobile/**` plus a changelog file — a spec that exercises
`apps/web`. Re-running the failed jobs on the **same SHA** came back green:
same commit, same job, nothing between the two runs but time. Red→green on
unchanged code is a sample, not a regression.

**The fix** is the discriminator Next already provides: `next-action`, the
request header attached to every Server Action POST (`ACTION_HEADER`,
`next/dist/client/components/app-router-headers.js:84`, read out of the
installed 15.5.23 rather than remembered). Clerk does not send it and neither
does any route handler.

**If a caller ever passes something that is not a Server Action this now
times out rather than resolving early, and that is the trade on purpose:** a
loud failure naming the wait beats a silent one that reads as a broken
feature. The helper's own name says "action".

**THE REAL CHANGE IS THAT THE DECISION IS NOW TESTABLE.** The predicate lived
inside a Playwright callback, where nothing in this repo could reach it — so
a wrong wait presented as four flaky specs rather than as one wrong line, for
weeks. It is now an exported pure function with a unit test beside it, and
the assertions are nearly trivial, which is the argument for them rather than
against.

Same shape as the cold-start header bug of the same week (#548/#553/#554): a
decision put somewhere no instrument can see it stays wrong for as long as it
takes somebody to notice by hand.

**Mutation-tested four ways, and M1 is the row that matters:**

| | mutation | reds on |
| --- | --- | --- |
| ctl | nothing | green |
| **M1** | **the shipped bug restored verbatim** | **three assertions** |
| M2 | method check dropped | the GET case |
| M3 | substring match instead of a key lookup | "merely contains the name" |
| M4 | header name drifted by one character | "accepts a Server Action post" |

M4 exists because a census could never catch a renamed header, and a
drifted constant would silently make every wait time out.

**Not claimed:** that this ends the flakes. It removes the documented
mechanism, and the only proof is consecutive clean runs — which `main` has
never produced, for the separate and still-open #418 reason. What can be said
is narrower and honest: the wait now resolves on our action and nothing else,
and that is now checkable in 1ms.
