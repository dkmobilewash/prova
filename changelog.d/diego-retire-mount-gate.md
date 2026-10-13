### The gate outlived the thing it was gating (Diego)

`diego/retire-mount-gate`

`AfterMount` was the mount gate written for #510: Clerk's `<UserButton>` renders
`clerk.loaded && <ClerkHostRenderer …/>` (`@clerk/clerk-react@5.61.9`,
`chunk-THNCS7QR.mjs:669`), and `loaded` is a mutable flag read **during render**
that is false on the server always. The server wrote no markup for it, and when
Clerk's script won the race against hydration the browser's first render
produced an element the server's HTML did not have — an element-level React
#418 on every signed-in page.

**Concept G (#748) replaced `<UserButton>` with its own avatar menu**, which
uses `useClerk()` only in click handlers and never to decide what to render. So
the last gated widget left, and with it everything that gate was protecting.

What was left behind:

| | |
| --- | --- |
| `components/AfterMount.tsx` | rendered by nothing |
| `components/afterMount.test.ts` | tests a component nothing uses |
| the census's "outside `<AfterMount>`" test | **iterated a set of zero and passed for ever** |

Found by walking every component in the app and asking which are rendered
nowhere, before and after the new UI. `AfterMount` was the only one the new UI
orphaned — and the test guarding it was the only one that had quietly stopped
asking a question.

#### What replaces it is stricter, not weaker

`clerkMountGate.test.ts` already had the part that matters and it stays: it
**names every Clerk component it finds** and pins the set to `["SignIn",
"SignUp"]`, so a widget coming back fails there first, by name. The vacuous test
beside it is now the plain rule — **no Clerk UI component may be rendered
anywhere this census can see, except the two sign-in pages** — with the #510
mechanism and its remedy written into the test itself, so whoever brings one
back lands on the answer rather than re-deriving it.

It also asserts the set it reasons about is non-empty, because `sites` is
"every file that imports Clerk" and a drifted import pattern would empty it and
pass about nothing. The two exempt pages are always in it, so that is the floor.

**Mutation-tested:** importing `UserButton` into `components/shell/TopBar.tsx`
and rendering it bare turns **two** tests red — the name ratchet and the rule.

#### Not deleted carelessly

Everything #510 established about the mechanism is preserved in the census,
which is where somebody adding a Clerk widget will be standing. What is gone is
a component with no callers and a test that could not fail.

#### Checks

Preflight green, 10,793 tests, no migration.
