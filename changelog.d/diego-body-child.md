### #510's regeneration always takes the same two nodes — and it is not Clerk (Diego)

`diego/body-child`

The mismatch locator named the container. This run names what the regeneration
removes, and **eliminates the mechanism I had already written up as the answer.**
The elimination is the more valuable half, so it goes first.

#### The hypothesis, and why it was convincing

`body-children.probe.spec.ts` lists `<body>`'s direct children from the DOM and
from the served HTML side by side:

| the server sends | the client appends |
| --- | --- |
| `div[hidden]`, the shell `div`, 2 scripts | ~28 scripts, `next-route-announcer`, `div#clerk-components`, `div#:r7:[data-floating-ui-portal]` |

**Clerk creates `div#clerk-components` as a direct child of `<body>`**, and
floating-ui appends a portal there. A third party appending a child to `body`
before React finishes hydrating it is an element-level mismatch at exactly the
container the locator keeps naming — the ColorZilla mechanism from CLAUDE.md's
#61 entry, arriving from a library instead of a browser extension.

It fit every piece of circumstantial evidence in the #418 entry: `args[]=HTML`
is an element and an injected `<div>` is an element; `body`-level with one child
differing; every authenticated page, because `ClerkProvider` is in the root
layout; a race, which is why the page lists are "the dice"; absent in a dev
build, where chunking and timing differ; and `AfterMount` delays the
`UserButton`'s *render* while doing nothing about Clerk's DOM injection, which
would explain why the residual survived that fix.

#### It is wrong

The locator was taught to report a third-party body injection landing inside the
error's 60ms window. On a runner: **7 mismatches, 74/74 loads hydrated, control
3/3, and NOT ONE carries `THIRD-PARTY INJECTION NEARBY`.**

Neither `clerk-components` nor the floating-ui portal is anywhere near the error
on any of the seven. **Clerk and floating-ui are eliminated by measurement.**
That is the tenth elimination on this defect, and without that one line in the
probe it would have shipped as the answer.

#### What the seven DO agree on, exactly

Every mismatch removes the **same two nodes and only those**:

```
/ask              GONE: div[hidden] , div.flex.h-screen.bg-canvas
/catalog          GONE: div[hidden] , div.flex.h-screen.bg-canvas
/backcharges      GONE: div[hidden] , div.flex.h-screen.bg-canvas
/prevailing-wage  GONE: div[hidden] , div.flex.h-screen.bg-canvas
/drawings         GONE: div[hidden] , div.flex.h-screen.bg-canvas
/material-orders  GONE: div[hidden] , div.flex.h-screen.bg-canvas
/submittals       GONE: div[hidden] , div.flex.h-screen.bg-canvas
```

Those are `body`'s two **server-rendered** element children. Seven unrelated
pages, the same pair, every time, with no extra node present when React
regenerates.

So the mismatch is between **what the server sent and what the client expected
of it** — not an interloper arriving late. And `div[hidden]` is in the diff
every single time: it is React's own streaming holder, server-emitted, carrying
no id (the Suspense holders all carry `id="S:n"`).

That is the first specific node attached to the mechanism the entry already
names as the survivor — Flight's 3,200-byte deferral. A holder the server emits
and the client's tree does not account for is exactly this signature.

#### What is measured, and what is still not

**Measured:** body's children, server versus client, on three routes. Seven
mismatches on a runner with every load proved hydrated and the control firing
3/3. The removed pair, identical across all seven. Clerk and floating-ui, out.

**Not measured:** why `div[hidden]` and the client disagree. Naming the node is
not the same as naming the cause, and the gap between those two is where this
investigation has lost a week at a time before.

#### Checks

- `body-children.probe.spec.ts` asserts only that BOTH lists were read. A pair
  of empty lists would print a tidy "(nothing)" and mean nothing at all.
- The locator asserts every load hydrated and that the control caught AND named
  an injected mismatch. A clean run with a dead control reports nothing and
  fails on it.
- Both probes live in `e2e/probes/`, invisible to the gating suite's `testDir`.
- No product code, no migration.
