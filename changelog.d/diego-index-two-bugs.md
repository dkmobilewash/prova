### Two bugs a browser run found in yesterday's index check (Diego)

`diego/index-two-bugs`

#715 stopped the drawing-index check reporting unread sheets as missing. A
browser run on production confirmed that, and found **two more things wrong with
the sentence it replaced them with.** Both were in the fix, not the original bug.

#### One — it contradicted the line directly above it

On Augusta it said **25 sheets** unread, three lines under the review's own
*"55 sheets: 32 to check, 23 need their numbers typed in"*.

Both numbers were right. They count different things: 23 pages have no proposal
at all, and 2 more have a proposal the reader could not name. For comparing
against a printed index those are the same problem — a page with no number
cannot be checked either way — which is why the total is 25. For somebody
reading two sentences together they are a contradiction with nothing to explain
it.

`unreadPageCount` returns the split now, and the sentence spends the words:

> 25 of these 55 sheets have no number yet **(23 not read, 2 the reader couldn't
> name)**, so this can't tell you what is missing…

The parenthetical appears only when both terms are non-zero. **Two numbers about
one set on one screen have to reconcile out loud or one of them stops being
believed** — and this is a check whose only job is to be believed.

#### Two — it told people to wait for something already finished

On Naples it said *"let the reading finish"* under a line reading **"53 of 53
sheets (100%) — 1 couldn't be read · Finished"**.

Page reading *had* finished. What had not run was the **title-block read** — the
stage that assigns sheet numbers, and a button somebody has to press. So the
check pointed at a wait instead of at the one action that unblocks it.

It names the action now: **"Read the title blocks, then check again."**

That is this module's own failure mode arriving a third time — a sentence that
sounds true and sends nobody anywhere useful. #715's commit message describes the
first two instances.

#### And a third bug, found while reading rather than reported

`unreadPageCount` counted **proposals**, not pages. A re-run of the reader leaves
two rows on one page, so two proposals looked like two read pages when one was,
and the unread count came out **low** — with `Math.max(0, …)` flooring it at
"nothing to do" and hiding it. `ProposedSheet` carries `pageNumber` now and the
count is over distinct pages.

#### Checks

- 42 cases in `drawingIndex.test.ts`, 11 in the call-site census.
- **Ten mutations, all ten red** — including the production bug put back, the
  split going unspoken, the page total dropped from the sentence, the wait
  restored in place of the action, a nameless page counting as read, the unread
  branch overruling an unreadable index, and both halves of the action (feeding
  a constant, and dropping `pageNumber` from the `select`).
- The Augusta and Naples sentences each have a case of their own, written from
  what was on screen.
- The census can see the counter is called and that `pageNumber` is selected. It
  still cannot see that the page count is right — the action opens a PDF from
  blob storage and nothing here can run it.

No schema change. Preflight green.
