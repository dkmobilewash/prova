import { money } from "@/lib/money";
import type { MoneyRailFigure, MoneyRailStage } from "@/lib/moneyRail";

/**
 * The Money Rail — the nav-as-pipeline concept, rendered.
 *
 * NOTHING RENDERS THIS FILE, AND THE SENTENCE THAT USED TO BE HERE IS WHY
 * NOBODY NOTICED. It read: "Deliberately NOT wired into any layout or nav
 * yet — the open nav PRs (#249) own those files, and this component waits
 * for them to land." Those PRs landed. `Sidebar.tsx` renders the Money Rail
 * itself (`STAGE_KEY_FOR_HEADING`, `figureMain`, `figureSub`,
 * `StageFigure`), fed by `getMoneyRailStages` from `app/(app)/layout.tsx`,
 * and `MoneyRail` is imported by no file in the repository — checked
 * 2026-09-24: `git grep -w MoneyRail` returns this file's own declaration
 * and nothing else.
 *
 * So this is a second, unreachable implementation of a shipped surface, and
 * the header was telling the next reader it was pending. Edit the Money Rail
 * in `Sidebar.tsx`; changing anything here changes nothing on screen. It is
 * left in place rather than deleted in a guard audit — deleting a component
 * days before a pilot is a product change, not a documentation fix — and is
 * reported for removal.
 *
 * PRESENTATIONAL ONLY. No data fetching, no Prisma, no auth: the caller
 * loads stages with getMoneyRailStages and hands them down, the same
 * split every dashboard panel uses.
 *
 * Colors are Tailwind builtins on purpose: bg-neutral-900 is #171717 and
 * text-yellow-400 is #facc15, exactly the charcoal-ground / yellow-accent
 * concept, and neither depends on this branch's design tokens — so the
 * component renders the same whether it merges before or after the token
 * swap.
 *
 * All arithmetic and wording happens in lib/moneyRail.ts; this file only
 * formats. A money figure goes through lib/money.ts like every other
 * dollar figure in the app — the model never does arithmetic in the UI
 * layer, and the UI never invents a number the lib did not compute.
 */

function figureText(figure: MoneyRailFigure): string {
  return figure.kind === "money" ? money(figure.amount) : `${figure.n} ${figure.noun}`;
}

export function MoneyRail({ stages }: { stages: MoneyRailStage[] }) {
  return (
    <nav aria-label="Money pipeline" className="flex flex-col bg-neutral-900">
      <ol className="flex flex-col divide-y divide-neutral-800">
        {stages.map((stage) => (
          <li key={stage.key} className="px-4 py-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              {stage.label}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-yellow-400">
              {figureText(stage.figure)}
            </p>
            <p className="mt-0.5 text-xs text-ink-muted">{stage.detail}</p>
          </li>
        ))}
      </ol>
    </nav>
  );
}
