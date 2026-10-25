### The bid recap moves when you type, says why Apply cannot, and shows the header's bid beside its own
`fix/estimate-seams`

Three seams from the 2026-10-19 walk of the Estimate tab, each reproduced in a
real Chromium against a production build of the app (Clerk stubbed, scratch
Postgres) before it was fixed.

**Typed line costs left "Direct cost of the work" at $0.00 until a reload.**
Nothing was un-revalidated. Next runs Server Actions one at a time, and React 19
commits none of a batch of async transitions until the last settles — so four
cost boxes typed in a row showed $0.00 for four full round trips (8.2s with 2s
of latency each) and then jumped. The panel now lays each sent edit over the
server's lines with `useOptimistic`, exactly as the rates already previewed from
the form's own state, and says "Saving…" while any save is still queued. Check:
type four costs and the figure moves on the first blur.

**"Apply to line prices" did nothing on cost-only lines, apparently silently.**
The no-op is intended — a cost-only line gets no share of the bid — so the fix
is the sentence: the panel now says, before anybody presses, that every line is
cost-only and to give the lines you sell a unit price (any figure; Apply
replaces it). Same sentence from the action, from the same function. Open
question for Diego: should Apply price cost-only lines when NO line is priced?

**The header said BID $0.00 above a recap Bid total of $10,249.47.** Both true:
the header is the line prices (the bid of record), the recap is what they become
once applied. The header now reads `bidTotalOf` instead of its own sum, and the
recap shows that same figure as "Bid on the job now" whenever applying would
change it. Check: the two match before Apply ($0.00) and the header moves to the
applied total after it, with no reload.
