### The pipeline's overdue badge was counting bids that were perfectly fine (Diego)

`diego/bid-standing`

`/pipeline` has shown a red badge since it was built:

```tsx
const overdueCount = live.filter((b) => b.overdue).length;
// → "{overdueCount} past the date they asked for"
```

`overdue` is `dueDate !== null && dueDate < today`. **There is no status in
it**, and `live` holds both `INVITED` and `SUBMITTED`.

So a bid submitted on time and waiting on the GC — **the normal state of every
bid anybody has ever sent** — counted as overdue from the day after the
deadline, forever. A desk with ten bids out for award read *"10 past the date
they asked for"* in red with nothing wrong anywhere. And the one bid that was
never submitted at all was in that number too, indistinguishable.

That is the failure `addenda-overlap.ts` names in its own words — *"a warning
that is almost always uninformative, which is a warning nobody reads"* — and
that `takeoff-currency.ts` refuses same-day supersession to avoid: *"calling
that superseded would cry wolf on every plan."*

#### Four states, because three of them want different people

| | |
| --- | --- |
| **DUE_SOON** | invited, deadline within three days, nothing sent. **The only one that can still be acted on** — once it is overdue the work is already wasted. |
| **MISSED** | invited, past the deadline, never sent and never declined. |
| **COLD** | submitted, six weeks past the deadline, no outcome. Step 9's follow-up. |
| **FINE** | everything else, including a bid submitted last week whose date has just passed. |

The page now shows one line per thing that wants doing, and the red badge is
kept for `MISSED` alone — the claim the old badge was making and almost never
true of.

Rolling them into *"6 bids need attention"* would be the number nobody reads,
one level up from the one this replaces: a bid due tomorrow wants an estimator
this afternoon, a missed one wants somebody to find out what happened, and a
cold one wants a phone call.

#### What was NOT changed, after nearly changing it

`isOverdue` in `bid-pipeline.ts` computes the same thing and feeds the per-GC
badge and the GC ranking. It looked like the same defect. It is not:
`GcRecord.overdue` documents itself as *"Outstanding AND past the date the GC
asked for"*, which is exactly what it computes, and ranking GCs by how many
bids sit past their date is a fair question about a GC.

**The defect was this page reading that number as "something is wrong here."**
Widening the fix would have changed the GC ranking on a misreading.

#### Two smaller decisions, each tested

- **An undated bid is not a late one.** Inventing a deadline is worse than
  silence in both directions: "fine" hides a bid due tomorrow, "missed" cries
  wolf on one entered five minutes ago.
- **The missed line allows for the bid that went out and was never recorded.**
  As likely as a missed deadline, and saying only the first would be wrong half
  the time.

`COLD` is six weeks because GCs routinely take four to eight on a public job.
Anything tighter chases bids that are proceeding normally — this file's own
failure mode, reintroduced one threshold along. No `submittedAt` exists, so the
wait is measured from the due date; that is sound at this scale and is why the
threshold is generous rather than tight.

#### Checks

- `bid-standing.test.ts` — 18 cases. **Eight mutations, all red**, including
  the original defect put back.
- `bidStandingCallSite.test.ts` — a census, because the page is a server
  component with database reads and nothing here can run it. **Two mutations,
  both red** after a tightening: the first version checked the markup was
  present, and gating it on `false &&` left it green. It now asserts the gate
  itself — and says in as many words that this is as far as a census reaches,
  with `/pipeline` in the click-list for the rest.
- That census first failed **on its own documentation**: the page names the old
  expression in prose, so the pattern matched a comment. #185's scar from the
  opposite direction — there a comment disarmed a census, here one tripped it.
  Comments are stripped, as `addendumWriteCensus.test.ts` does.
- No schema change.
