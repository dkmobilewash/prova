### A light, high-contrast theme for reading a phone outdoors (Cyrus)
`cyrus/ui-light-theme`

The app was dark only, and dark grey text at 12px washes out in direct sun.
There is now a System / Light / Dark switch in the sidebar footer, the phone
menu and Settings → Appearance. It is saved per browser and applied by a tiny
script in `<head>` before first paint, so a light-theme reader never sees a
dark flash. With no choice saved, the app follows the phone's own setting.

The colour tokens are now CSS variables. Both palettes live as hex in
`tailwind.config.ts` (`palette.dark`, `palette.light`) and a plugin there
emits them, so the file `theme-contrast.test.ts` measures is the file that
ships. Dark stays the default, and the public pages were screenshotted
against `main` at 1280 and 375: 0 pixels differ.

The light palette is held to stricter floors than dark because it is meant
for sunlight: body text at 7:1 or better, muted text at 4.5:1, card outlines
at 3:1 against their ground, and a `focus` ring token at 3:1, all checked on
canvas, card, chrome and hover lift. A pair that fails in either theme fails
the build. Brand yellow stays a fill with a dark label in both themes. As
text it is darkened in light, because yellow on white is 1.5:1.

The sweep moved 935 raw colour utilities across 227 files onto tokens.
Those include `text-red-400` → `danger`, `amber-400` → `warn`, `green-400` →
`ok`, `bg-neutral-800/700` → `rail-hover`/`lift`, and the last pre-reskin
`slate-*` classes. The white paper documents (WH-347, DAS-140/142, photo
report, remittance) were left untouched on purpose. The one place a
`color-scheme: light` is allowed is the `[data-theme="light"]` block, and
`colorSchemeGround.test.ts` now says so instead of banning it.
