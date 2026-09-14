"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Hint } from "@/components/Hint";
import { activeGroupHeading, navGroupsFor } from "@/components/navItems";
import { money } from "@/lib/money";
import type { Principal } from "@/lib/permissions";
import type { MoneyRailFigure, MoneyRailStage } from "@/lib/moneyRail";

/**
 * The Money Rail: a 240px nav column whose group headings carry the five
 * live pipeline figures — Bidding, Building, Proving, Staying legal,
 * Getting paid.
 *
 * No hover-to-expand any more. The old 64px rail expanded as an overlay so
 * labels only existed under the cursor; a rail whose headings ARE the money
 * pipeline has to be readable at rest, so it is w-60 always and the spacer
 * below reserves the same width in the layout.
 *
 * **The GROUPS collapse; the headings and their figures never do.** Restored
 * 2026-09-12, because the rewrite that added the figures dropped the collapse
 * behaviour the rail used to have and rendered every item of every group at
 * once. That is ~1400px of nav in an 800px viewport, so the column scrolled
 * and the LAST figure — "Getting paid", the one the product is about — sat
 * below the fold. A rail that hides your money to show you a link to
 * Settings has defeated itself.
 *
 * "Always visible" was STRUCTURAL, and the mechanism was one number —
 * `min-h-16` on an open group, the measured height of a heading plus its
 * figure. An open group could shrink to it, giving up ITEM height so a
 * figure never scrolled away, and the item list was its own scroll box.
 *
 * REPLACED 2026-09-13, and the reason is worth more than the mechanism was.
 * It did keep every figure on screen. What it did on a real screen, with
 * four groups open, was give each group a 72px box of its own: Pre-construction
 * showed four of its seven items, Financials one of three, and nothing on
 * screen said there was more. The items were reachable and the rail looked
 * broken, which is the worse half of that trade. Cyrus hit it while staging
 * the demo, and it is the second time this file has learned that a rule
 * proved at one window size behaves differently once somebody actually opens
 * everything.
 *
 * Now: nothing shrinks, every group is its natural height, the COLUMN
 * scrolls, and each group's heading is `sticky top-0` against the rail's own
 * background. So the figure of the group you are reading stays pinned at the
 * top while its items scroll underneath it, and the group you scroll into
 * takes over the pin. The guarantee is unchanged — you can always see a
 * figure, and you can always reach every item — but it is paid for with a
 * scroll rather than a squeeze, and every item gets its full height.
 *
 * The sticky heading MUST carry an opaque background (`bg-rail`). Without it
 * the items scroll visibly through the heading text, which looks like a
 * rendering fault rather than a pinned header.
 *
 * Collapsed, the whole rail measures 463px at 1280x800 — logo row, five
 * headings, five figures — so every figure is on screen with room for the
 * active group's items open (last figure at y=443, nothing scrolling).
 *
 * The cost, stated because it is a real one: open more groups than fit and
 * each open list becomes a short scrolling sliver rather than the column
 * scrolling. That is the deliberate trade — the figures are the product, a
 * nav item is one scroll away either way.
 *
 * Toggles are INDEPENDENT — `open[key] = !open[key]`, several groups open at
 * once. NOT an accordion: that behaviour was clicked through in a prototype
 * and approved as-is, and "opening one closes another" is a different product
 * decision wearing the same chevron. `Sidebar.test.ts` holds that shape down.
 *
 * The rail is `bg-rail` #171717, deliberately LIFTED off the #0f0f0f canvas
 * rather than darker than it. This paragraph used to say the rail "stays
 * dark under the light theme" so the chrome would recede by being the one
 * dark surface; the dark flip took the light canvas away and left that
 * sentence describing nothing. On this palette the chrome recedes by being
 * quiet, and the lift is what keeps the column readable as a column instead
 * of dissolving into the page — the same note tailwind.config.ts carries on
 * the token. What has not changed is why it matters: it is what lets the
 * brand-yellow figures be the loudest thing in the chrome.
 *
 * THE GROUP MODEL IS #240's — six groups (Pre-construction, Operations,
 * Paper trail, Logistics, Financials, Compliance & safety), their order,
 * their route membership, and `activeGroupHeading` from navItems.tsx, whose
 * longest-href match is what puts /vendors/pricing in Logistics and
 * /settings/assistant in Financials rather than in whichever group's prefix
 * matched first. None of that is re-litigated here; this file only decides
 * how the column LOOKS and which groups are open.
 *
 * Two things it deliberately does NOT take from #240, both for the same
 * reason — the five figures:
 *
 *  - it does not share `useNavAccordion` with the mobile drawer. That hook
 *    is one-group-at-a-time, and an accordion is fine on a 360px screen
 *    carrying no figures. Here the toggles are INDEPENDENT (below), which
 *    the founder approved off a prototype;
 *  - it is not the 64px hover-expand rail. A rail whose headings ARE the
 *    money pipeline has to be readable at rest, so it is w-60 always and
 *    the group icons #240 added for the 64px state are not drawn here (the
 *    drawer still draws them). A heading's row is the heading, the chevron
 *    and the figure.
 *
 * NO MONEY ARITHMETIC HERE. Every figure arrives fully computed from
 * lib/moneyRail.ts (getMoneyRailStages, called by the server layout) and a
 * money amount is formatted by lib/money.ts like every other dollar figure
 * in the app. This file only places text.
 */

/**
 * Which pipeline stage a nav group's heading carries. By meaning:
 * Pre-construction is where bids live, Operations is the building work,
 * Compliance & safety is staying legal, Financials is getting paid.
 * Logistics carries no stage — vendors and equipment are cost machinery,
 * not a pipeline stage — so it keeps a plain heading. Neither does #240's
 * "Paper trail"; see the "Proving" note in the component for why that one
 * is a decision rather than an omission.
 *
 * KEYED BY HEADING TEXT, which is the fragile part and the reason it is
 * exported: these four strings live in navItems.tsx, the shared file, and a
 * rename there would match nothing here and quietly drop four of the five
 * figures. `Sidebar.test.ts` asserts every key is a real heading and that
 * all five stage keys are placed, so the failure is named instead of seen.
 */
export const STAGE_KEY_FOR_HEADING: Record<string, MoneyRailStage["key"]> = {
  "Pre-construction": "bidding",
  Operations: "building",
  "Compliance & safety": "staying-legal",
  Financials: "getting-paid",
};

/** The big yellow number. Money goes through lib/money.ts; a count is the
 * bare integer, with its noun on the line below. */
function figureMain(figure: MoneyRailFigure): string {
  return figure.kind === "money" ? money(figure.amount) : String(figure.n);
}

/** The small line under the figure: the stage name for a dollar figure
 * (the amount speaks for itself), the noun for a count (a bare "3" says
 * nothing without "items waiting on the GC"). */
function figureSub(stage: MoneyRailStage): string {
  return stage.figure.kind === "money" ? stage.label : stage.figure.noun;
}

/**
 * Spans, not paragraphs, and `block` rather than the browser's default.
 * A figure renders INSIDE the heading `<button>` now, so the whole
 * heading-plus-money block is one target — and `<p>` is not phrasing
 * content, so a button containing one is invalid HTML that the parser
 * fixes up into a tree React did not render. That is the `<li>`-inside-`<li>`
 * hydration scar (issue #149) waiting to happen again; spans cannot cause
 * it. Visually identical.
 */
function StageFigure({ stage }: { stage: MoneyRailStage }) {
  return (
    <span className="block px-4 pb-1" title={stage.detail}>
      <span className="block truncate text-lg font-semibold leading-tight tabular-nums text-brand">
        {figureMain(stage.figure)}
      </span>
      <span className="block truncate text-xs font-medium leading-5 text-neutral-300">
        {figureSub(stage)}
      </span>
    </span>
  );
}

/** The id the heading's `aria-controls` points at. Derived from the heading
 * so the two cannot drift apart; "Compliance & safety" has to come out as
 * something that is legal in an id attribute. */
export function navGroupPanelId(heading: string): string {
  const slug = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `nav-group-${slug}`;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform ${
        open ? "rotate-90" : ""
      }`}
    >
      <path
        d="M8 6l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Sidebar({
  companyName,
  principal,
  showsInternal = false,
  stages,
}: {
  companyName: string;
  principal: Principal;
  /** Prova's own operating company only -- see Company.isProvaOperator. */
  showsInternal?: boolean;
  /** The five money-pipeline figures, loaded server-side by the layout
   * with getMoneyRailStages. Never computed here. */
  stages: MoneyRailStage[];
}) {
  // Filtered here rather than in the layout so the desktop rail and
  // the mobile drawer run the same function on the same input.
  const groups = navGroupsFor(principal, { showsInternal });
  const pathname = usePathname();
  const activeHeading = activeGroupHeading(groups, pathname);

  // One boolean per heading, and the only writer flips exactly one key.
  // Absent means closed, so the initial state is literally "the active
  // group, and nothing else".
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    activeHeading ? { [activeHeading]: true } : {},
  );

  // Arriving at a page from somewhere other than this rail — a topbar link,
  // a card on the dashboard, a pasted URL — opens the group that holds it,
  // so the highlighted item is never hidden inside a collapsed group. It
  // only ever OPENS, and only when the active group CHANGES: closing the
  // active group by hand therefore sticks, which an effect that reasserted
  // the whole state on every render would not.
  useEffect(() => {
    if (!activeHeading) return;
    setOpen((prev) => (prev[activeHeading] ? prev : { ...prev, [activeHeading]: true }));
  }, [activeHeading]);

  const stageByKey = new Map(stages.map((stage) => [stage.key, stage]));
  // "Proving" (RFIs out, submittals with the GC) renders as its own linkless
  // heading row, in pipeline order — after the group that carries "Building".
  // It is a SIBLING of that group rather than a child of it, which is what
  // keeps it on screen: a figure nested inside Operations would vanish with
  // Operations' items, and it is one of the five.
  //
  // CORRECTED at the #249 merge, because the reason written here was true
  // and is not any more. It said /rfis and /submittals had been removed from
  // the rail on 3 Sep 2026, so Proving had no group to sit on. #240 put them
  // back, in a new group: "Paper trail" is /rfis, /submittals, /drawings,
  // /closeout — the first two being exactly what this figure counts. So the
  // stage COULD now hang off that heading like the other four, and the
  // orphan row could go.
  //
  // It is left alone on purpose, for Cyrus to call rather than a merge:
  // moving it would take the word "Proving" off the rail entirely (a heading
  // reads its group's name, and a count figure's sub-line is its noun, so
  // the pipeline stage's own label is what would be lost), and the five
  // stage names were approved as the rail's vocabulary. Nothing is broken
  // either way — the figure is on screen and outside every collapse in both
  // arrangements. Flagged in the merge report.
  //
  // If it does move, it is two edits: add `"Paper trail": "proving"` to the
  // map above and delete the sibling row at the bottom of the group loop.
  // MOVED 2026-09-13, on Cyrus's call while staging the demo: the Proving
  // row now sits after the group carrying "getting-paid" (Financials)
  // rather than after "building" (Operations). The rail reads big money
  // first — 418k, 776k, 648k — and only then the two small counts, Proving
  // and Compliance. Anchoring by STAGE KEY rather than by heading text is
  // deliberate: the headings are Cyrus's to rename and the anchor should
  // not quietly break when he does.
  const provingStage = stageByKey.get("proving");
  const provingAfterHeading = Object.entries(STAGE_KEY_FOR_HEADING).find(
    ([, key]) => key === "getting-paid",
  )?.[0];

  return (
    // The spacer holds the layout: same width as the fixed rail, so the
    // content column starts where the rail ends. Mobile is untouched —
    // below md the rail does not render and MobileNav takes over.
    <div className="print:hidden hidden w-60 shrink-0 md:block">
      <nav
        aria-label="Main"
        className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-rail"
      >
        <div className="flex h-14 shrink-0 items-center gap-3 px-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand text-sm font-semibold text-neutral-900">
            P
          </span>
          <span className="truncate whitespace-nowrap text-[15px] font-semibold text-white">
            {companyName}
          </span>
        </div>

        {/* Ask is a LINK, not a collapsible group. It was briefly a group of
            its own and Cyrus killed it on sight, correctly: a disclosure
            triangle that hides exactly one item is pure friction — you pay a
            click to learn there was nothing to choose. It sits above the
            groups, outside the scroll, so it never moves and is always the
            first thing on the rail. */}
        {/* pb-4 lives HERE, not as the scroll box's padding-top. See the
            note on that container below: `sticky top-0` pins against the
            scrollport's PADDING box, so 16px of padding-top there is a band
            the items scroll through in the open, above the pinned heading.
            The air is the same; it is just on the side of the scroll edge
            where nothing can slide under it. */}
        <div className="shrink-0 px-2 pb-4 pt-3">
          <Link
            href="/ask"
            data-ask-link
            className={`flex min-h-11 items-center gap-3 rounded-md px-2 text-[15px] font-semibold transition-colors ${
              pathname === "/ask"
                ? "bg-brand text-neutral-900"
                : "text-ink hover:bg-rail-hover"
            }`}
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0" aria-hidden="true">
              <path
                d="M10 2.5 11.6 7l4.4 1.6L11.6 10 10 14.5 8.4 10 4 8.6 8.4 7 10 2.5Z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
            <span className="truncate whitespace-nowrap">Ask C Stream</span>
          </Link>
        </div>

        {/* `pb-4`, NOT `py-4`, and this is a measurement rather than taste.
            Each group heading is `sticky top-0`, and a sticky offset resolves
            against the scrollport's PADDING box — so `padding-top: 16px` here
            pinned every heading 16px BELOW the container's visible top edge
            and left a 16px band above it where nav items scrolled past in
            full view. On screen that is a nav row sliced in half, floating
            over the money figure: it reads as a rendering fault rather than
            as scrolling.

            Measured in the running app, not reasoned about — the heading's
            rect sat exactly 16px below the scroller's, matching the padding
            to the pixel, and moving those 16px onto the Ask block above
            closed the gap to 0. Bottom padding is untouched because nothing
            sticks to the bottom. */}
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden pb-4">
          {groups.map((group) => {
            const stageKey = STAGE_KEY_FOR_HEADING[group.heading];
            const stage = stageKey ? stageByKey.get(stageKey) : undefined;
            const isOpen = open[group.heading] === true;
            const panelId = navGroupPanelId(group.heading);

            return (
              // The Fragment is what lets the "Proving" row below be a
              // SIBLING of this group rather than a child of it: no DOM node,
              // so both boxes are flex children of the column and Proving
              // keeps its place in pipeline order without inheriting
              // Operations' collapse.
              <Fragment key={group.heading}>
                {/* REPLACED 2026-09-13. This used to carry a min-height floor
                    so an open group could SHRINK, giving up item height to
                    keep its figure on screen. It worked, and it was wrong in
                    a way only a real screen shows: with four groups open each
                    one became its own 72px scroll box, so Pre-construction
                    showed four of its seven items and Financials one of three
                    — with no affordance saying there was more. Reachable, and
                    indistinguishable from broken.

                    Now nothing shrinks. Every group is its natural height,
                    the COLUMN scrolls, and the heading below is sticky — so
                    the figure of the group you are reading stays pinned at
                    the top of the rail while its items scroll under it. Same
                    guarantee ("you can always see the money"), paid for with
                    a scroll instead of a squeeze. */}
                <div className="flex shrink-0 flex-col gap-1">
                  {/* #264's description, kept — with its `title` dropped
                      rather than kept alongside it. On THIS rail the heading
                      is never hidden (w-60 always), so #264's own reason for
                      the hint does not apply and a better one does: the
                      heading is two words and the figure under it is a
                      number, and neither says what is filed in the group.
                      "Paper trail — $0" is the least self-explanatory thing
                      on the column. The `title` it replaces repeated the
                      heading text verbatim, which is invisible to a keyboard
                      and says nothing to a mouse.

                      Hint is `display: contents`, so it adds no box: the
                      button stays the same flex item, and `sticky top-0`
                      still resolves against the scrolling column. */}
                  <Hint text={`${group.heading} — ${group.description}`}>
                  <button
                    type="button"
                    onClick={() =>
                      // The whole of the independence: one key, flipped. Not a
                      // reset, not "close the others".
                      setOpen((prev) => ({ ...prev, [group.heading]: !prev[group.heading] }))
                    }
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    // #240's hook, kept: a click-through can name a group
                    // without reading its text or its colour.
                    data-nav-group={group.heading}
                    // min-h-11 is 44px, the standard pointer/touch target.
                    // Without it a group with NO figure is only its 12px
                    // heading line — Paper trail and Logistics were about
                    // 20px tall and felt unnatural to hit, while the four
                    // that carry a figure were ~70px. The floor makes every
                    // heading the same easy target whether it has a number
                    // under it or not. w-full so the whole row is the
                    // target, not just the text.
                    className="sticky top-0 z-10 flex w-full min-h-11 shrink-0 cursor-pointer flex-col justify-center bg-rail py-2 text-left hover:bg-rail-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                  >
                    <span className="flex items-center gap-1.5 px-4">
                      <span className="min-w-0 flex-1 truncate whitespace-nowrap text-xs font-bold uppercase tracking-wider text-neutral-300">
                        {group.heading}
                      </span>
                      <Chevron open={isOpen} />
                    </span>
                    {stage ? <StageFigure stage={stage} /> : null}
                  </button>
                  </Hint>

                  {/* The items. Closed means NOT RENDERED — no opacity, no
                      height trick: a link that is invisible but tabbable is
                      the worst of both, and this way there is nothing to
                      reach. `hidden` and the display:none class are belt and
                      braces for the empty box that keeps aria-controls
                      pointing at something real. */}
                  <div
                    id={panelId}
                    hidden={!isOpen}
                    className={isOpen ? "flex flex-col gap-1" : "hidden"}
                  >
                    {isOpen
                      ? group.items.map((item) => {
                          const isActive =
                            pathname === item.href || pathname.startsWith(`${item.href}/`);

                          // A disabled item is not a link and not focusable. As
                          // of 3 Sep 2026, /safety and /material-orders render
                          // this way deliberately (see navItems.tsx) despite
                          // being built and working — the branch exists for
                          // exactly that case too, not only for a genuinely
                          // unbuilt feature.
                          if (item.disabled) {
                            return (
                              <span
                                key={item.href}
                                title={`${item.label} — coming soon`}
                                aria-disabled="true"
                                className="flex h-11 shrink-0 cursor-not-allowed items-center gap-3 px-4 text-[15px] font-semibold text-neutral-600"
                              >
                                <span className="shrink-0 opacity-50">{item.icon}</span>
                                <span className="truncate whitespace-nowrap">{item.label}</span>
                              </span>
                            );
                          }

                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              aria-current={isActive ? "page" : undefined}
                              title={item.label}
                              className={`flex h-11 shrink-0 items-center gap-3 px-4 text-[15px] font-semibold transition-colors ${
                                isActive
                                  ? "bg-rail-hover text-brand shadow-[inset_3px_0_0_#facc15]"
                                  : "text-neutral-300 hover:bg-rail-hover hover:text-white"
                              }`}
                            >
                              <span className="shrink-0">{item.icon}</span>
                              <span className="truncate whitespace-nowrap">{item.label}</span>
                            </Link>
                          );
                        })
                      : null}
                  </div>
                </div>

                {provingStage && group.heading === provingAfterHeading ? (
                  <div className="flex shrink-0 flex-col gap-0.5">
                    <p className="truncate whitespace-nowrap px-4 text-xs font-bold uppercase tracking-wider text-neutral-300">
                      {provingStage.label}
                    </p>
                    <StageFigure stage={provingStage} />
                  </div>
                ) : null}
              </Fragment>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
