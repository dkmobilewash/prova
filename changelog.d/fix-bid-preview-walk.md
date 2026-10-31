### C Stream Bid: what a real browser walk of the preview tripped on, fixed (Cyrus)
`claude/modest-fermat-tf98pl`

First time anyone drove the /bid preview end to end as a drywall sub, 2026-10-30
on `3c507346`. Every number the screens computed was right; what was wrong was
everything around the numbers.

- **The ask box and the invite reader both said "unavailable" while Check
  connection said the key worked** — 0 tokens on every call, and the reason
  only in a runtime log. A failed model call now shows Anthropic's own status
  and error type on screen (or "the Anthropic credit balance is too low",
  which is otherwise an indistinguishable 400). The check: press the ask box on
  the preview and read the parenthesis. The invite-read failure also stopped
  sending the owner to "Settings → Assistant", which Bid does not have.
- **Recap offered Apply with no rates set**, which would have taken $33,720.00
  of typed prices to $22,440.00 of bare cost. Off now, with the reason; the
  title says lowers or raises from the real numbers. No money math changed.
- **Screens that "updated" without updating** — Apply, the board-layers answer:
  the message was set after an `await`, outside the transition, so it
  committed ahead of the slow post-action render (#61's shape). Both now land
  with the new figures.
- Bids log: saved bid shows without a reload, "Same job as…" fills name and
  trade, the same-job hint hides once linked, "Start the estimate" is on the
  row, "Sent —" reads "Not sent yet", research stops counting the same job's
  other GC as a similar past bid.
- Rail: "Walls measured" is Skipped, not Done, for typed lines with nothing
  measured, and adding a run no longer pulls it back. The card on one GC's
  proposal names that GC and its adjusted price.
- Wall types: Bid offers its trades' 8 starters, not flooring/paint/concrete;
  starter names stop stating a layer count; hang is split from tape-and-finish
  so only hanging doubles with layers.
- `components/bid/bidEstimateTabs.ts` renamed `bidEstimateTabRoutes.ts`: it
  differed from `BidEstimateTabs.tsx` only in case, and broke `tsc` on macOS.

Still open, deliberately: Apply prices every line by one blended factor rather
than its cost type's markup, and lands $34.38 under the recap on this job —
Diego's call.
