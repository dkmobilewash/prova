### A form closed two seconds before the row behind it caught up (Diego)
`diego/form-closes-on-fresh-data`

**The timestamp CLAUDE.md's #61 entry has been asking for since 5 September.**
That entry says a report of this shape — committed row, stale screen, reload
fixes it — "needs a timestamp before it counts as evidence", because nobody had
ever recorded how long they waited. Somebody did. On production, editing a bid
quote's expiry, nothing clicked afterwards, no reload, polled from the page
every 250ms with the clock started on the Save click:

| | |
| --- | --- |
| Save pressed | t0 |
| action resolved, edit form **closed** | **1,251 ms** |
| row repainted with the saved value | **3,502 ms** |
| still correct at | 15,000 ms |

**So it was never a lost update.** The write lands, revalidation fires, the DOM
corrects itself without a reload — at 3.5s, inside the 1.5–4.4s post-action
server render #61 already measured.

**The defect is the gap between those two rows, and it is a UI bug rather than
a data one.** `ActionForm` ran `onSuccess` the instant `await action(formData)`
resolved, so for **2.25 seconds** the form was gone — telling the estimator the
save had finished — while the row behind it still showed the old value. That is
why this reads as a lost update: the thing you were editing disappears,
confirming the action worked, and the screen contradicts you. Two separate
click-throughs reported it as a bug; neither timed it, and an untimed report of
this shape is indistinguishable from a real lost update.

`onSuccess` and the reset now fire from a settle effect gated on
`useTransition`'s `isPending`, which is false only once the transition's own
re-render has committed — so a form closes onto fresh data. The reset moves
with it because blanking the fields at 1.25s while the form stays up until 3.5s
trades one wrong frame for another. **The cost, stated because it is real:** a
successful save leaves the form open ~2s longer, button disabled and spinning
throughout, which reads as work in progress rather than as nothing happening.

One shared fix for 16 files rather than a patch on the row that reported it.

**What the test can and cannot see.** It pins that the callback runs from the
settle effect and not from inside the transition body — resolve the action
without flushing effects and nothing has been called yet — and it is NOT
vacuous: restoring the immediate call reds it with *"closed before the
transition settled"*. It cannot see the 2.25-second window, which exists only
when a Server Action's flight response drives a re-render, and there is no
server, no flight payload and no repaint in happy-dom. **The browser is the
only instrument for that half**, which is how this was found and how it should
be confirmed.

**And the wrong diagnosis is worth more than the fix.** Before timing it I
concluded `SubmitButton`'s spinner was dead in every `ActionForm`:
`useFormStatus` is documented as reporting a form submitted through the `action`
prop, this form uses `onSubmit`, so it followed. False.
`components/actionForm.test.ts` had already measured that exact inference, says
in its header it "looked like it must break `SubmitButton`" and does not, and
asserts `disabled` and `aria-busy` mid-flight. Its closing line is *"This test
exists so that stays true rather than being rediscovered."* I rediscovered it
from the React docs without reading the test beside the component, and a Slack
message claiming 16 files were broken went out before I ran it. Retracted in
the same channel. CLAUDE.md's #61 entry now carries both the measurement and
that mistake.

`typecheck`, `lint`, 569 files / 8,857 unit tests.
