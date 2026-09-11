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

### The sidebar becomes the Money Rail (Cyrus)
`cyrus/theme-flip-yellow` (same branch, filmed demo)

The rail is now a permanently expanded 240px column (no hover-to-expand
overlay) whose group headings carry the five live pipeline figures from
`lib/moneyRail.ts` — Bidding, Building, Proving, Staying legal, Getting
paid — big, yellow (`text-brand`), on the charcoal `bg-rail` ground. The
mapping is by meaning: Pre-construction ← Bidding, Operations ← Building,
Compliance & safety ← Staying legal, Financials ← Getting paid; Logistics
keeps a plain heading. Proving (open RFIs + submittals with the GC) has
no group to sit on since the 3 Sep nav cut removed those routes from the
rail, so it renders as its own linkless heading row after Operations,
keeping pipeline order.

The rule the component enforces rather than merely follows: NO money
arithmetic in the UI. `app/(app)/layout.tsx` calls `getMoneyRailStages`
server-side (inside the existing `Promise.all`, so it adds no waterfall)
and `Sidebar` renders the stages verbatim, dollars through `lib/money.ts`.
Every figure is the same derivation the page it points at already uses —
that is `lib/moneyRail.ts`'s whole design, see its header.

The specific check: the layout spacer and the fixed nav are both `w-60`
(they were `w-16` + hover overlay; `grep -n w-16 components/Sidebar.tsx`
must return nothing), and no `opacity-0` label tricks remain in the rail.
Mobile untouched — `MobileNav` still owns everything below `md`.
