### The app flips to the yellow/black/white light theme (Cyrus)
`cyrus/theme-flip-yellow`

The design tokens in `tailwind.config.ts` held DARK values since 79e1fac
repointed them — the stalled light migration meant one tokenized page
(the dashboard) and 24 pages of raw slate classes. The founder approved a
yellow/black/white palette and the demo films today, so this is the flip
in one pass: token values first (white canvas and cards with 1px #171717
outlines, charcoal #171717 rail, #facc15 brand), then every page converted
from raw slate classes to the tokens.

Two decisions worth knowing over reading the diff. **Yellow carries no
text and no white label**: `brand` is a fill that always takes a #171717
label at 600-700 weight, and links are new `link`/`link-hover` tokens
(#a16207/#854d0e) — `theme-contrast.test.ts` now asserts white-on-brand is
UNREADABLE (<3:1), which is the assertion that stops the old
`bg-brand text-white` button pattern coming back. And **semantic colours
kept their meanings**: dark translucent chips became the light tag pairs
(error red, success green, warning amber), with the old blue "in progress"
chip becoming the brand chip (#facc15/#422006) per the mockups.

The specific check: `pnpm test` carries the contrast maths for every
token pair, and `grep -rn 'slate-[0-9]' apps/web/app apps/web/components`
returns only `Sidebar.tsx`/`MobileNav.tsx` (Diego's #240 lane, dark rail
anyway) and the deliberate white-paper print documents (WH-347, union
remittance). Class values only — no markup moved, and the three fixed
section slots in `jobs/[id]/page.tsx` were verified in order after the
edit.
