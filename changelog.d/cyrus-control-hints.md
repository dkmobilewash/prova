### Every control that deletes something or moves money now says what it does (Cyrus)
`cyrus/control-hints`

Cyrus asked for this in one sentence: descriptions on buttons, on hover.
The reason it is worth a PR rather than a tooltip library is who is
looking at the screen. "Backcharge", "Release retainage", "Close out",
"Send to QuickBooks" are all labels a foreman knows — and not one of them
says whether pressing it writes a row here or puts a document in front of
the GC. A fifteen-person office cannot tell those apart from the button,
and somebody who cannot tell does not press it. An unclicked feature is an
unsold one.

`components/Hint.tsx` is the new component and the whole of the mechanism.
Hover AND keyboard focus both reveal it, because a hover-only tooltip is
nothing at all to anyone tabbing; the words are wired with
`aria-describedby` rather than `title`, so a screen reader reads them in
both states; `title` came OFF the nav rail's group buttons rather than
being kept alongside, because two tooltips saying different things is
worse than one.

**The hard constraint was geometry, not prose.** Most of what needed
describing is a delete button in a row's action cluster, and this repo's
rule 2 for those — "Cancel inherits the Delete pixel" — rests on overlap
percentages measured in real Chromium against the actual class strings. A
wrapper that adds a box around a row action moves those pixels and
silently invalidates every one of those numbers, and no test here can
catch it: happy-dom does no layout. So `Hint` adds no box. The wrapper is
`display: contents` (the same device `ConfirmDelete`'s armed column
already uses at >=640px, where it measured byte-identical), the tooltip is
`position: fixed` and out of flow, and it carries `hidden` until asked
for, so it is never a flex item and never eats a gap. On top of that,
`ConfirmDelete` attaches the hint to the UNARMED delete button only —
once armed it renders exactly the DOM it rendered before this branch
existed. `hint.test.ts` asserts those three class names literally, since
they are the entire argument and the positions themselves are
unobservable here.

On touch there is no hover to have, and this is honest about it: a tap
closes the tooltip rather than leaving one standing over the row you just
changed, the popover is `pointer-events-none` and the wrapper has no box,
so nothing can intercept the tap. The words stay available to assistive
technology. Visible helper text, not a popover, is the real fix for a
phone.

**What is covered, and what is not.** All 45 two-step deletes in the app.
The two record-deleting one-click buttons outside the other lane's file
(QuickBooks Disconnect, Remove on /team). Nine money-control sites under
eight labels — pay application, backcharge, log payment, and the two
QuickBooks pushes, the last two being the only buttons in the whole set
that genuinely leave the building. All four figures in the metric bar,
where nothing anywhere said what "Cash collected" or "Estimated revenue"
counted. And every nav group heading — six for an ordinary company, seven
for Prova's own — which at 64px was an icon and a `title` that repeated the
heading.

NOT covered, and deliberately: creating an invoice and recording a
retainage release, both of which live only in
`app/(app)/jobs/[id]/page.tsx`, the other lane's file by name in CLAUDE.md.
Nor the ~27 nav ITEMS (the rail expands on hover, which answers the
question better than a tooltip), nor the mobile drawer (there is no hover
on a phone), nor the several hundred ordinary buttons — openers, cancels,
edit toggles, tab switches — that this was never about.

`hintCensus.test.ts` fails the build when a two-step delete or a named
money control has no description. Its scanners are JSX parsers, which is
exactly the shape this repo has been bitten by — a guard that passed
thirteen assertions while parsing 180 of 181 foreign keys — so each
scanner has a fixture test of its own and each derived set is counted
against a literal that cannot drift with it. Mutation-proved three ways:
remove one `describe` and it names the file; change `contents` to a real
box and the geometry test goes red; break the element scanner so it
matches nothing and SIX tests fail, including all three size checks,
rather than the file going quietly green.

One cost worth stating: each metric-bar figure is a tab stop now. A
hover-only explanation is no explanation for a keyboard, and the only way
a static figure takes focus is `tabIndex`. Four stops at the end of every
page.

**Found in passing and not fixed here:** eleven buttons in this app delete
a record on ONE click — they never went through `ConfirmDelete` at all, so
neither this census nor `rowActionsCensus.test.ts` can see them. Two are
covered by a hint on this branch (QuickBooks Disconnect, and Remove on
/team); the other NINE are all in `app/(app)/jobs/[id]/page.tsx`, one of
them deleting a retainage release. That is the other lane's file by name in
CLAUDE.md: it needs an issue, not this PR. The count is in
`hintCensus.test.ts` beside the rule that derived it.
