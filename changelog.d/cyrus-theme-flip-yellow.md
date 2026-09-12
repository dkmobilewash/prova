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

### The assistant writes a whole punch list: `add_punch_items` (Cyrus)
`cyrus/theme-flip-yellow` (same branch, filmed demo)

Asked "can you make punch list items out of this list", the assistant used
to answer that it does "one item per card, so a punch list with eight items
means eight passes" — and it was telling the truth, which is worse. The old
`add_punch_item` command was mode HANDOFF: its card opened `/punch-lists`
with ONE item prefilled and the person saved it there, so the assistant
never created anything at all.

The reason was never the punch list; it was the throw.
`createPunchListItem` threw its refusals, production redacts a thrown
Server Action message, and a card cannot show a sentence that never
arrives — so `commands.coverage.test.ts` correctly forces a command over a
throwing action to be HANDOFF. So the action's body is LIFTED into
`lib/field/punch-list-items.ts` (`createPunchListItems`), the same
arrangement as `lib/billing/create-invoice.ts`: typed args in, an
`ActionResultWith` out, the job asserted in-company there, no FormData and
no `revalidatePath`. The form path keeps its throw by converting the
returned sentence back into one, so its behaviour and its words are
unchanged, and NEITHER path has its own copy of the validations.

`add_punch_items` is therefore DIRECT: one confirm writes every item, all
inside one `$transaction`, so a list that fails halfway leaves no half. The
list arrives as ONE newline-separated string, because `CommandInput` is
strings only, and the split happens in code — blank lines dropped, list
bullets stripped, repeats within the list and anything already open on that
job skipped, every skip named in a card warning, and the whole thing capped
at 25 with a refusal that says what to do with the rest. The card previews
EVERY item it is about to create, since the person confirms the lot once.

**The old command is retired, not kept for the single case.** It handles
1..N, and two commands for one job is a coin flip the model makes
mid-sentence — on camera. That took `loadPunchDraft` with it (nothing can
propose an `add_punch_item` card again, so a loader for one is the
"written, documented, never called" shape), and with it the `?draft=`
plumbing on the punch list page and in `PunchListForm`.

Authorization is unchanged and enforced twice on each path: the form
action still calls `requireCapabilityForAction("MANAGE_FIELD")`, and on the
command path `commandsFor()` filters the list the model sees while
`confirmAskProposal` re-checks `canRunCommand` before it executes — plus
the core re-asserts the job in-company, which is the boundary a
server-held payload crosses.

One thing this surfaced without touching it: `settleAskDraft` was excused
by the capability-guard census only because it was reachable from two
pages wanting DIFFERENT capabilities. With punch items no longer a HANDOFF
it has one door (`/rfis`, MANAGE_JOBS) and no capability assertion of its
own, so it is now listed in that file's debt list with the reason. What
actually guards it is row ownership; the fix is a judgement about the ask
machinery (whether the card's own command is one this person could run),
which is Diego's lane.

The specific checks: 27 new unit tests, two of them mutation-proved
(previewing only the first item, and moving the creates out of the
transaction, each turn a test red); a dbtest that writes a real list to
Postgres and proves the rollback on a failure that lands on the SECOND
item (a NUL byte, which Postgres refuses with 22021 — a failure on the
first item would prove nothing about rollback); and the command driven end
to end against `ep-icy-hat`, resolve then execute, which put 4 rows on
"Riverside Medical Office Building [demo]" from a 7-line paste containing
two blanks and one repeat, then refused the identical list a second time
with the job still at 9 items.
