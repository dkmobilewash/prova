### The phone looks like the product now (Diego)
`diego/phone-matches-desktop`

The web app is dark — #0f0f0f canvas, #1a1a1a cards, hairline #3d3d3d
outlines, brand yellow fills with dark labels. The phone was white. A GC
handed the phone and then shown the web app was looking at two different
tools, which is Diego's call to fix and the right one.

**The phone was light on purpose, and that reasoning is kept rather than
quietly deleted:** the field app gets opened outdoors, in direct sun, on a
wet dirty screen, and dark grounds mirror in sunlight while near-black on
white stays legible through glare. It is a real argument that lost to a
bigger one — product identity — and it was never tested on a roof. If the
field does complain, a light "sunlight" mode is cheap from here, because
what this change proves is that the palette is one file.

That is the part worth knowing for next time. The phone's tokens already
carried the SAME SEMANTIC NAMES as the web's (`canvas`, `surface`, `rail`,
`ink`, `ink-body`, `brand`, `link`, `line-card`), and 22 of the app's 25
files read them, so the re-skin was a file of values plus the chrome —
not the codebase-wide edit the web's own tailwind config warns about
having been through once.

What changed beyond colour, because "looks like the desktop" is not only
colour: the navigation chrome. Headers and the tab bar were stock iOS
white; they take the lifted `rail` (#171717 on #0f0f0f, the same trick the
web's sidebar uses), the back chevron and the active tab take the brand
yellow, the status bar goes light, and `userInterfaceStyle` is now `dark`
so the keyboard, pickers and action sheets stop arriving white. The splash
screen was already #0f0f0f, which is why the app flashed dark and then
turned white.

What deliberately did NOT change: 44pt minimum tap targets, 17px body text,
52pt primary buttons. None of that was about colour, and all of it is why
the app works in gloves.

**Flipping a palette is exactly when contrast breaks quietly** — every ink
was chosen against white and is now on near-black — so
`apps/mobile/lib/theme-contrast.test.ts` asserts all sixteen pairs the app
renders, primary text at 7:1 rather than 4.5:1 because the screen is
outdoors. It also fails the build on a hex literal in any screen or
component, since a hardcoded colour is precisely the thing a palette flip
cannot reach. Mutation-tested: darkening `inkBody` to #3a3a3a turns it red.
The web learned this the hard way — white on the founder yellow at 1.53:1,
on nine pages, under a comment saying not to.
