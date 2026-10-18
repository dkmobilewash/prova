### Fifteen model calls were spent on fifteen blank images

A browser tester read a real scanned sheet end to end on the live app: **15
requests, every one a 200, forty-four seconds**, and the answer *"No writing
could be made out on this sheet."*

**The model was right. It was handed blank tiles.**

The page offset each tile by pre-applying `ctx.translate(...)` and letting
`page.render` draw through it. That works in the **Node** build — the eval
reads 101 of 101 printed strings that way — and it does not work in the
browser. The offset belongs in pdf.js's own `transform` parameter, where it is
composed with the viewport transform inside `beginDrawing`; nothing about a
canvas's prior state is part of that contract.

**Worth naming why the eval could not catch this.** It renders through
`canvasFactory` in Node and the viewer renders in a browser, and those are
different implementations of the same call. An eval that passes on the library
you are not shipping is the same shape as a census that reads source and
cannot see whether a framework honours it — *nothing is ever missing from the
implementation you did not run.*

**The expensive part is not the bug, it is that money was the instrument.**
Counting the ink on a tile costs nothing and happens before the request, so:

- a blank picture is never sent, and never charged for;
- a sheet whose tiles are **all** blank now says **the render failed**, which
  is ours, instead of *"faint or low-resolution scan"* — a sentence that sends
  somebody hunting for a better copy of a drawing that was fine.

The floor is `BLANK_TILE_INK = 0.0002`, an order of magnitude below the
emptiest tile that still holds words (0.184% ink, measured by
`tileSkip.eval.ts`). It refuses genuinely empty pictures and nothing else —
that file already established that skipping *quiet* tiles cannot be done
safely.

**5 of 5 mutations red**, the first being `ctx.translate` restored exactly.

What the same run confirmed working: the switch refuses in **0.9 seconds** now
(it hung silently for five minutes two builds ago), the counter climbs, all
fifteen requests return 200, and "Read this sheet" correctly does not appear
on a vector sheet that already has its scale.
