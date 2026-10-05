### Unticking one firm of a slot, in a browser — the half of that fix nothing could prove

The row-key fix has five db cases against a real Postgres. They cover the SERVER: that a
multi-bidder labelled form imports at all, that one column imports without the other, and
that two rows on one lead write the shared claims once.

**The screen's half had none and could have none.** `chosen[row.line]` was one boolean for
both firms of a slot, so unticking either unticked both and one "Already a lead?" applied to
both — and that state lives in the component, which nothing in this repo renders. A db test
builds the FormData itself; it can never press a checkbox.

So step 10 does the thing the aliasing made impossible: it pastes a form printing two firms
across one line, **unticks one of them**, and requires the other to keep its own state.

- both names asserted absent from `/sales` first;
- the button says **2** before the untick and **1** after — a number the product composes
  from its per-row state, singular and plural included;
- the kept row's checkbox asserted still CHECKED after the other is unticked. That is the
  regression directly: with one boolean for both it would be unchecked;
- the dropped firm asserted absent from the leads afterwards, so the untick reached the
  server rather than only the screen;
- and the kept lead's claim quotes `(line 7 of the listing)` — the line the two firms
  SHARE, which is the provenance being honest rather than inventing a line per column.

The form's second slot is present and empty because `buildingConnectedListing` dispatches
only on two "Name of Business" and two "License No." lines; a one-slot form takes the
ordinary table path and the step would be about a different reader. That is also what the
real documents look like: six slots printed, two used.

Three unit cases pin the premise so a red e2e run never has to teach it — that the two rows
really come off ONE line, that both are in our trades so the untick is the only thing
separating them, and that the summary's counts and the quoted claim are what the app's own
reader produces. 490 unit tests, from 487.
