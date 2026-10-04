### What actually changed, in plain English (Cyrus)
`cyrus/seed-counters-zzbqtu`

**Two things Cyrus hit while filming, and one of them is bigger than it looks.**

**The Ask box was a single-line `<input>`.** Type more than a few words and the
caret runs off to the right, taking the start of the question with it — so the
one box in the app that invites a long sentence was the one box that would not
show you the sentence. The whole draft-an-estimate flow is one long sentence.
It is a `<textarea>` now: it wraps, it grows to about six lines and then
scrolls, Enter still sends and Shift+Enter makes a line break, because every
chat box in the world sends on Enter and somebody demoing it will press Enter.

**Nothing in this product had a loading indicator. Not one.** A search for
`animate-spin` or `Spinner` across every component returned nothing, while
**133 in-flight states** were a word that stopped changing — `"Saving…"` ×115,
`"Sending…"` ×7, `"Working…"` ×4, and the rest. Cyrus named the cost exactly:
a label that sits still reads as a crash. An ellipsis promises that something
is happening and nothing on screen was keeping the promise.

`components/Spinner.tsx` is the missing piece. An SVG stroke in
`currentColor`, so it is the colour of the text beside it in light, dark and
outdoor without needing a token of its own; `h-[1em]` so it scales with
whatever it sits in; `aria-hidden`, because the word next to it already says
what is happening and "loading loading" is worse than either; and
`motion-reduce:animate-none`, because a spinner is the canonical thing
somebody turns motion off for.

**Where it went first, and why there.** The Ask panel's status line, which is
the one on screen for the whole 5–7 second wait. Its own comment has said
since it was written that *"a static message for eight seconds reads as a hang
rather than as work"* — and then showed a static message. The code knew.

**The census that caught the loose end.** `numericInputCensus` went red:
`INPUT_EXCEPTIONS` still named `AskPanel.tsx (unnamed)`, which covered the
question box and the file input beside it. The question box is not an `<input>`
any more and a `type="file"` is not something that census flags, so nothing in
that file matched and the dead entry had to go. That refusal is the point — an
exception list nobody prunes becomes permanent, which is the same reason
`KNOWN_UNREACHABLE` is pruned by its own test.

**The other 130 are not done.** This adds the component and uses it in the
three places that matter for a demo — the Ask button, the Ask status line, and
the WH-347 page-2 save. Sweeping the remaining `"Saving…"` sites is a
mechanical change across about a hundred files, and landing a hundred-file diff
an hour before filming is how a demo breaks. It is worth doing deliberately,
with a census that keeps a loading word and a spinner together, and that is its
own change.
