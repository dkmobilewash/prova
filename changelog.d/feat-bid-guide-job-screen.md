### A bid's screen now leads with where it stands and the one thing it needs (Cyrus)
`feat/bid-guide-job-screen`

An estimate in C Stream Bid used to open on a header and four tabs and leave the person to
work out what came next. It now opens on a step rail (invite, walls, price, proposal, send —
done, current, to do, each with its summary line), an AI headline, and ONE yellow-bordered
card holding the thing that needs them, with its buttons. The four tabs stay, as a compact row
under the card, because the recap has no step of its own. The "Ask or tell me anything" box is
drawn at the bottom, disabled, saying it is coming.

A button that only goes somewhere is a link. A button that WRITES (apply the recap, use a past
price) is two steps: pressing it swaps the whole button row for [Cancel] [Yes, do it], and only
the second press calls `runGuideAction`, which gates on MANAGE_ESTIMATING and reuses
`applyBidRecap` rather than redoing the recap maths. On a phone the rail becomes a five-across
step strip and the ask card comes straight after it.

The screen is built from a `JobGuide` and nothing else. `lib/bid/guide/index.ts` is a
PLACEHOLDER returning null until the real engine is merged in; with a null guide the layout
renders the header and tabs exactly as before. Check: `jobGuideScreen.test.tsx` renders every
fixture and requires every href to start with /bid and at most one primary button.
