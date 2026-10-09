### #510 is a third party putting a child in `<body>` (Diego)
`diego/body-child`

The mismatch locator named the container; this names what is in it. Measured,
not inferred — `body-children.probe.spec.ts` lists `<body>`'s direct children
from the DOM and from the served HTML side by side:

| the server sends | the client appends |
| --- | --- |
| `div[hidden]`, the shell `div`, 2 scripts | ~28 scripts, `next-route-announcer`, **`div#clerk-components`**, **`div#:r7:[data-floating-ui-portal]`** |

`div[hidden]` is **server-rendered** — React's own streaming holder, and not the
culprit despite being the unexplained node that started this. The culprits are
the two the CLIENT appends: Clerk creates `div#clerk-components` as a direct
child of `<body>`, and floating-ui appends a portal there.

**A third party appending a direct child of `body` before React finishes
hydrating it is an element-level mismatch at exactly the container the locator
keeps naming.** It is the same mechanism as the ColorZilla scar in CLAUDE.md's
#61 entry — a browser extension injecting into `body` — arriving from a library
instead of an extension.

#### Why it fits everything the entry already records

- `args[]=HTML` — an ELEMENT, not text. An injected `<div>` is an element.
- `body`-level, one child differing. Six pages, one container.
- **every authenticated page**, because `ClerkProvider` is in the root layout.
- **a race**, because it depends on whether the injection beats hydration. That
  is why the page lists are "the dice" and why only `/dashboard` ever recurs.
- **absent in a development build**, where chunking and timing differ.
- `AfterMount` (the shipped fix) delays the `UserButton`'s RENDER. It does
  nothing about Clerk's own DOM injection, which is why the residual survived it.

#### What is measured and what is not

Measured: body's children, server versus client, on three routes. The locator
naming `body` six times out of 74 loads on a runner, with the control firing
3/3.

**Not yet measured: the injection landing within the error's window.** The
locator now reports it when it does — `THIRD-PARTY INJECTION NEARBY` — and the
local run that would have shown it came back 0 of 74, because the race barely
fires on a fast laptop. That line needs a runner to print, which is the next
dispatch rather than a claim made here.

So this is the mechanism with the motive and the opportunity, and not yet the
fingerprint.

#### Checks

- `body-children.probe.spec.ts` asserts only that BOTH lists were read. A pair
  of empty lists would print a tidy "(nothing)" and mean nothing at all.
- Both probes live in `e2e/probes/`, invisible to the gating suite.
