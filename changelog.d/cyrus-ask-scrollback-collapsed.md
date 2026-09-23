### The conversation moves above the box, and every old answer closes (Cyrus)
`cyrus/ask-page-context`

The scrollback shipped **below** the input, which put the conversation in
the wrong reading order: you typed at the top and the history grew
underneath, so the newest exchange — the one a follow-up is about — was the
furthest thing from the box you were about to type into. It is above the
input now, oldest at the top, newest nearest the hand. The input is the one
fixed thing in the panel with everything the sitting produced stacked above
it, which is how every chat a person has ever used is laid out.

**Every prior exchange is CLOSED.** A row shows three things: the question
in the person's own words, when it was answered, and which pages it read
("3 minutes ago · Cash flow, Invoices"). A tap opens it to the full answer,
the clickable citations and the staleness mark. Six questions now fit in the
box that two used to fill.

**A closed row never shows a fragment of the ANSWER, and that is the whole
design decision rather than a styling choice.** The obvious summary of an
exchange is the answer's first sentence, and it is the one thing that must
not go there:

> Nothing is overdue on Riverside. $32,300 is overdue on Brackett, 15 days
> out.

clipped to its first sentence reads as a clean bill — on the exact question
somebody asked *because they were worried*. A truncated answer makes a new,
shorter, **false** claim. A truncated question is visibly the reader's own
words with an ellipsis on the end, and the worst it can do is fail to
remind them which question it was, which the tap fixes. `summarizeQuestion`
is where that argument lives, and a test asserts the false clean bill never
reaches a row.

**Collapsing also moved the staleness mark, and improved it.** The mark
travels with the figures it is about: a closed row carries no number at all,
so there is nothing on it to misread, and the "the figures were read then —
Ask again" sentence appears inside the opened row, next to the figures it
qualifies. A stale number is never merely *on screen* now — somebody chose
to look at it, and the sentence is beside it when they do.

Rows are keyed by **when they were asked**, not by their index: the
transcript trims at twenty, every index shifts down one when it does, and an
index key would silently open a different person's row.

`AskPanel`'s header said *"no scrollback is rendered, old answers are not
redisplayed"* for the whole life of the commit that added one. Corrected in
this diff rather than deleted, because the shape is the one this repo keeps
paying for: a sentence describing what the code does **not** do goes stale
the moment somebody builds it, and it reads as a decision to whoever gets
there next.

Five tests on `summarizeQuestion`, all four mutation-tested — deleting the
word-boundary search, the whitespace flatten, or the no-spaces fallback each
turns one red. The stale note also moved off `text-amber-400`, which is not
a token in this app's config, onto `text-tag-amber-ink`, which is.
