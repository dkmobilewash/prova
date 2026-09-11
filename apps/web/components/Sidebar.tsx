"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navGroupsFor } from "@/components/navItems";
import { money } from "@/lib/money";
import type { Principal } from "@/lib/permissions";
import type { MoneyRailFigure, MoneyRailStage } from "@/lib/moneyRail";

/**
 * The Money Rail: a permanently expanded 240px nav column whose group
 * headings carry the five live pipeline figures — Bidding, Building,
 * Proving, Staying legal, Getting paid.
 *
 * No hover-to-expand any more. The old 64px rail expanded as an overlay so
 * labels only existed under the cursor; a rail whose headings ARE the money
 * pipeline has to be readable at rest, so it is w-60 always and the spacer
 * below reserves the same width in the layout.
 *
 * It stays dark under the light theme, deliberately. A dark rail against a
 * light canvas is what makes the chrome recede and the work come forward —
 * and it is what lets the brand-yellow figures read as the loudest thing
 * in the chrome without competing with the page.
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
 * not a pipeline stage — so it keeps a plain heading.
 */
const STAGE_KEY_FOR_HEADING: Record<string, MoneyRailStage["key"]> = {
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

function StageFigure({ stage }: { stage: MoneyRailStage }) {
  return (
    <div className="px-4 pb-1" title={stage.detail}>
      <p className="truncate text-lg font-semibold leading-tight tabular-nums text-brand">
        {figureMain(stage.figure)}
      </p>
      <p className="truncate text-[11px] leading-4 text-neutral-400">{figureSub(stage)}</p>
    </div>
  );
}

export function Sidebar({
  companyName,
  principal,
  showsSalesCrm = false,
  stages,
}: {
  companyName: string;
  principal: Principal;
  /** Prova's own operating company only -- see Company.isProvaOperator. */
  showsSalesCrm?: boolean;
  /** The five money-pipeline figures, loaded server-side by the layout
   * with getMoneyRailStages. Never computed here. */
  stages: MoneyRailStage[];
}) {
  // Filtered here rather than in the layout so the desktop rail and
  // the mobile drawer run the same function on the same input.
  const groups = navGroupsFor(principal, { showsSalesCrm });
  const pathname = usePathname();

  const stageByKey = new Map(stages.map((stage) => [stage.key, stage]));
  // "Proving" (RFIs out, submittals with the GC) has no nav group to sit
  // on: those routes were removed from the rail on 3 Sep 2026 (see
  // navItems.tsx) while the pages themselves still exist and the money
  // still waits on the GC. So it renders as its own linkless heading row,
  // in pipeline order — after the group that carries "Building".
  const provingStage = stageByKey.get("proving");
  const buildingHeading = Object.entries(STAGE_KEY_FOR_HEADING).find(
    ([, key]) => key === "building",
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
          <span className="truncate whitespace-nowrap text-sm font-semibold text-white">
            {companyName}
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden py-3">
          {groups.map((group) => {
            const stageKey = STAGE_KEY_FOR_HEADING[group.heading];
            const stage = stageKey ? stageByKey.get(stageKey) : undefined;

            return (
              <div key={group.heading} className="flex flex-col gap-0.5">
                <p className="truncate whitespace-nowrap px-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  {group.heading}
                </p>
                {stage ? <StageFigure stage={stage} /> : null}

                {group.items.map((item) => {
                  const isActive =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);

                  // A disabled item is not a link and not focusable. As of
                  // 3 Sep 2026, /safety and /material-orders render this way
                  // deliberately (see navItems.tsx) despite being built and
                  // working — the branch exists for exactly that case too,
                  // not only for a genuinely unbuilt feature.
                  if (item.disabled) {
                    return (
                      <span
                        key={item.href}
                        title={`${item.label} — coming soon`}
                        aria-disabled="true"
                        className="flex h-10 cursor-not-allowed items-center gap-3 px-4 text-sm font-medium text-neutral-600"
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
                      className={`flex h-10 items-center gap-3 px-4 text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-rail-hover text-brand shadow-[inset_3px_0_0_#facc15]"
                          : "text-neutral-300 hover:bg-rail-hover hover:text-white"
                      }`}
                    >
                      <span className="shrink-0">{item.icon}</span>
                      <span className="truncate whitespace-nowrap">{item.label}</span>
                    </Link>
                  );
                })}

                {provingStage && group.heading === buildingHeading ? (
                  <div className="mt-4 flex flex-col gap-0.5">
                    <p className="truncate whitespace-nowrap px-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                      {provingStage.label}
                    </p>
                    <StageFigure stage={provingStage} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
